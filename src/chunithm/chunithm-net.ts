import { Crypto } from "@common/crypto";
import { AllNetMaintenanceError, FailedToDecryptError } from "@common/error";
import { isAllNetMaintenance } from "@common/maintenance";
import type { Chart, Difficulty } from "gcm-database/chunithm";
import type { Database } from "gcm-database-otogedb/chunithm";
import { BaseScoreAdapter, type DataOrError, FailedToFetchError } from "maidraw";
import { AchievementTypes, ChainLamp, type ChunithmScoreAdapter, ClearLamp, ComboLamp, type Score } from "maidraw/chunithm";
import { CHUNITHMRating } from "rg-stats";
import { ChunithmNetScraper } from "./lib/scraper/chunithm";
import type { NetScore } from "./lib/scraper/types";

export class ChunithmNetAdapter extends BaseScoreAdapter implements ChunithmScoreAdapter {
    protected scraper = new ChunithmNetScraper();
    // CHUNITHM-NET maintenance starts at 02:00 JST, earlier than the 04:00 of other ALL.Net services.
    protected readonly maintenanceStartHour: number = 2;

    async getPlayerInfo(token: string, _type: "new" | "recents") {
        if (isAllNetMaintenance(this.maintenanceStartHour)) return { err: new AllNetMaintenanceError(this.maintenanceStartHour, "chunithm") };
        if (!Crypto.global) Crypto.global = await Crypto.new();
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;
        const cached = await this.cache.get(`profile-${segaId}`);
        if (cached) return { data: cached as { name: string; rating: number } };
        const cookies = await this.scraper.login(segaId, password);
        if (cookies.err) return cookies;
        const profile = await this.scraper.getProfile(cookies.data);
        if (profile.err) return profile;
        const res = {
            name: profile.data.name,
            rating: profile.data.rating,
        };
        this.cache.put(`profile-${segaId}`, res, 5 * 60 * 1000);
        return { data: res };
    }
    async getPlayerProfilePicture(_token: string) {
        return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "profile picture", "Unsupported") };
    }
    async getPlayerScore(_token: string, _chartIdentifier: string) {
        return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "score", "Unsupported") };
    }
    private database: Database;
    constructor({
        name = "chunithm-net-adapter",
        database,
    }: {
        name?: string;
        database: Database;
    }) {
        super({ name });
        this.database = database;
    }

    async getPlayerBest50(token: string): Promise<DataOrError<{ new: Score[]; old: Score[]; best?: Score[] }>> {
        if (isAllNetMaintenance(this.maintenanceStartHour)) return { err: new AllNetMaintenanceError(this.maintenanceStartHour, "chunithm") };
        if (!Crypto.global) Crypto.global = await Crypto.new();
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;

        const cached = await this.cache.get(`best50-${segaId}`);
        if (cached) return { data: cached as { new: Score[]; old: Score[]; best?: Score[] } };

        const cookies = await this.scraper.login(segaId, password);
        if (cookies.err) return cookies;
        const rawBest = await this.scraper.getBest(cookies.data, this.database);
        const newScores = rawBest.new.map((v) => this.toMaidrawScore(v)).sort(ChunithmNetAdapter.byRating);
        const oldScores = rawBest.old.map((v) => this.toMaidrawScore(v)).sort(ChunithmNetAdapter.byRating);
        const best50 = {
            new: newScores.slice(0, 20),
            old: oldScores.slice(0, 30),
        };
        const b50 = {
            ...best50,
            best: best50.new.concat(best50.old).sort(ChunithmNetAdapter.byRating),
        };
        this.cache.put(`best50-${segaId}`, b50, 5 * 60 * 1000);
        return { data: b50 };
    }

    async getPlayerRecent40(token: string): Promise<DataOrError<{ recent: Score[]; best: Score[] }>> {
        if (isAllNetMaintenance(this.maintenanceStartHour)) return { err: new AllNetMaintenanceError(this.maintenanceStartHour, "chunithm") };
        if (!Crypto.global) Crypto.global = await Crypto.new();
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;

        const cached = await this.cache.get(`recent40-${segaId}`);
        if (cached) return { data: cached as { recent: Score[]; best: Score[] } };

        const cookies = await this.scraper.login(segaId, password);
        if (cookies.err) return cookies;
        const rawBest = await this.scraper.getBest(cookies.data, this.database);
        const rawRecent = await this.scraper.getRecent(cookies.data, this.database);
        if (rawRecent.err) return rawRecent;

        const best = rawBest.new
            .concat(rawBest.old)
            .map((v) => this.toMaidrawScore(v))
            .sort(ChunithmNetAdapter.byRating)
            .slice(0, 30);
        const recent = rawRecent.data.map((v) => this.toMaidrawScore(v)).slice(0, 10);
        const recent40 = { recent, best };
        this.cache.put(`recent40-${segaId}`, recent40, 5 * 60 * 1000);
        return { data: recent40 };
    }

    private static byRating(a: Score, b: Score) {
        return b.rating - a.rating || b.score - a.score;
    }

    private static getAchievementRank(score: number) {
        if (score >= 1009000) return AchievementTypes.SSSP;
        else if (score >= 1007500) return AchievementTypes.SSS;
        else if (score >= 1005000) return AchievementTypes.SSP;
        else if (score >= 1000000) return AchievementTypes.SS;
        else if (score >= 990000) return AchievementTypes.SP;
        else if (score >= 975000) return AchievementTypes.S;
        else if (score >= 950000) return AchievementTypes.AAA;
        else if (score >= 925000) return AchievementTypes.AA;
        else if (score >= 900000) return AchievementTypes.A;
        else if (score >= 800000) return AchievementTypes.BBB;
        else if (score >= 700000) return AchievementTypes.BB;
        else if (score >= 600000) return AchievementTypes.B;
        else if (score >= 500000) return AchievementTypes.C;
        else return AchievementTypes.D;
    }
    private static getComboLamp(combo: string) {
        switch (combo) {
            case "fullcombo":
                return ComboLamp.FULL_COMBO;
            case "alljustice":
                return ComboLamp.ALL_JUSTICE;
            case "alljusticecritical":
                return ComboLamp.ALL_JUSTICE_CRITICAL;
            default:
                return ComboLamp.NONE;
        }
    }
    private static getChainLamp(chain: string) {
        switch (chain) {
            case "fullchain":
                return ChainLamp.FULL_CHAIN;
            case "fullchain2":
                return ChainLamp.FULL_CHAIN_JUSTICE;
            default:
                return ChainLamp.NONE;
        }
    }
    private static getClearLamp(clear: string) {
        switch (clear) {
            case "clear":
                return ClearLamp.CLEAR;
            case "failed":
                return ClearLamp.FAILED;
            case "hard":
                return ClearLamp.HARD;
            case "brave":
                return ClearLamp.BRAVE;
            case "absolute":
                return ClearLamp.ABSOLUTE;
            case "catastrophy":
                return ClearLamp.CATASTROPHY;
            default:
                return ClearLamp.NONE;
        }
    }
    private toMaidrawScore(score: NetScore): Score {
        const level =
            score.dbChart?.internalLevel ??
            (() => {
                const displayed = score.dbChart?.level ?? "";
                if (displayed.includes("+")) {
                    return parseInt(displayed, 10) + 0.5;
                } else {
                    return parseInt(displayed, 10) || 0;
                }
            })();
        return {
            chart: score.dbChart ?? ChunithmNetAdapter.fallbackChart(score),
            score: score.score,
            rank: ChunithmNetAdapter.getAchievementRank(score.score),
            combo: ChunithmNetAdapter.getComboLamp(score.combo),
            chain: ChunithmNetAdapter.getChainLamp(score.chain),
            clear: ChunithmNetAdapter.getClearLamp(score.clear),
            rating: CHUNITHMRating.calculate(score.score, level),
        };
    }
    private static fallbackChart(score: NetScore): Chart {
        return {
            identifier: "0",
            title: score.name,
            artist: "",
            difficulty: score.difficulty as Difficulty,
            level: "",
            notes: { tap: 0, hold: 0, slide: 0, air: 0, flick: 0 },
            bpm: [0],
            designer: "-",
            optionalData: {},
        };
    }
}
