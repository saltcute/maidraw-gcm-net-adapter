import { Crypto } from "@common/crypto";
import { FailedToDecryptError } from "@common/error";
import { type Chart, type Difficulty, LunaticType } from "gcm-database/ongeki";
import type { Database } from "gcm-database-otogedb/ongeki";
import { BaseScoreAdapter, type DataOrError, FailedToFetchError } from "maidraw";
import { AchievementTypes, BellLamp, ComboLamp, type OngekiScoreAdapter, type Score } from "maidraw/ongeki";
import { ONGEKIRating } from "rg-stats";
import { OngekiNetScraper } from "./lib/scraper/ongeki";
import type { NetScore, RecentScore } from "./lib/scraper/types";

export class OngekiNetAdapter extends BaseScoreAdapter implements OngekiScoreAdapter {
    protected scraper = new OngekiNetScraper();

    async getPlayerInfo(token: string, _type: "refresh" | "classic") {
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
        name = "ongeki-net-adapter",
        database,
    }: {
        name?: string;
        database: Database;
    }) {
        super({ name });
        this.database = database;
    }

    async getPlayerBest60(token: string): Promise<DataOrError<{ new: Score[]; old: Score[]; plat: Score[]; best: Score[] }>> {
        if (!Crypto.global) Crypto.global = await Crypto.new();
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;

        const cached = await this.cache.get(`best60-${segaId}`);
        if (cached) return { data: cached as { new: Score[]; old: Score[]; plat: Score[]; best: Score[] } };

        const cookies = await this.scraper.login(segaId, password);
        if (cookies.err) return cookies;
        const rawBest = await this.scraper.getBest(cookies.data, this.database);
        const newScores = rawBest.new.map((v) => this.toMaidrawScore(v, "refresh")).sort(OngekiNetAdapter.byRating);
        const oldScores = rawBest.old.map((v) => this.toMaidrawScore(v, "refresh")).sort(OngekiNetAdapter.byRating);
        const allScores = newScores.concat(oldScores);
        const best60 = {
            new: newScores.slice(0, 15),
            old: oldScores.slice(0, 50),
            plat: allScores
                .filter((v) => v.starRating > 0)
                .sort(OngekiNetAdapter.byStarRating)
                .slice(0, 50),
            best: [...allScores].sort(OngekiNetAdapter.byRating).slice(0, 60),
        };
        this.cache.put(`best60-${segaId}`, best60, 5 * 60 * 1000);
        return { data: best60 };
    }

    async getPlayerBest55(token: string): Promise<DataOrError<{ recent: Score[]; new: Score[]; old: Score[]; best: Score[] }>> {
        if (!Crypto.global) Crypto.global = await Crypto.new();
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;

        const cached = await this.cache.get(`best55-${segaId}`);
        if (cached) return { data: cached as { recent: Score[]; new: Score[]; old: Score[]; best: Score[] } };

        const cookies = await this.scraper.login(segaId, password);
        if (cookies.err) return cookies;
        const rawBest = await this.scraper.getBest(cookies.data, this.database);
        const rawRecent = await this.scraper.getRecent(cookies.data);
        if (rawRecent.err) return rawRecent;

        const newScores = rawBest.new.map((v) => this.toMaidrawScore(v, "classic")).sort(OngekiNetAdapter.byRating);
        const oldScores = rawBest.old.map((v) => this.toMaidrawScore(v, "classic")).sort(OngekiNetAdapter.byRating);
        const allScores = newScores.concat(oldScores);

        const chartMap = new Map<string, NetScore>();
        for (const v of rawBest.new.concat(rawBest.old)) {
            chartMap.set(`${v.name} ${v.difficulty}`, v);
        }
        const recentScores = rawRecent.data.map((v) => this.toMaidrawScore(this.recentToNetScore(v, chartMap), "classic"));

        const best55 = {
            recent: recentScores.slice(0, 10),
            new: newScores.slice(0, 15),
            old: oldScores.slice(0, 30),
            best: [...allScores].sort(OngekiNetAdapter.byRating).slice(0, 45),
        };
        this.cache.put(`best55-${segaId}`, best55, 5 * 60 * 1000);
        return { data: best55 };
    }

    private static byRating(a: Score, b: Score) {
        return b.rating - a.rating || b.score - a.score;
    }
    private static byStarRating(a: Score, b: Score) {
        return b.starRating - a.starRating || b.score - a.score;
    }

    private recentToNetScore(recent: RecentScore, chartMap: Map<string, NetScore>): NetScore {
        const matched = chartMap.get(`${recent.name} ${recent.difficulty}`);
        return {
            name: recent.name,
            level: matched?.level ?? "",
            difficulty: recent.difficulty,
            dbChart: matched?.dbChart,
            rank: recent.rank,
            bell: recent.bell,
            combo: recent.combo,
            score: recent.score,
            platinumScore: Number.NaN,
            maxPlatinumScore: Number.NaN,
        };
    }

    private static getAchievementRank(score: number) {
        if (score >= 1007500) return AchievementTypes.SSSP;
        else if (score >= 1000000) return AchievementTypes.SSS;
        else if (score >= 990000) return AchievementTypes.SS;
        else if (score >= 970000) return AchievementTypes.S;
        else if (score >= 940000) return AchievementTypes.AAA;
        else if (score >= 900000) return AchievementTypes.AA;
        else if (score >= 850000) return AchievementTypes.A;
        else if (score >= 800000) return AchievementTypes.BBB;
        else if (score >= 750000) return AchievementTypes.BB;
        else if (score >= 700000) return AchievementTypes.B;
        else if (score >= 500000) return AchievementTypes.C;
        else return AchievementTypes.D;
    }
    private static getStar(ratio: number) {
        if (Number.isNaN(ratio) || ratio < 0 || ratio > 1) return 0;
        if (ratio >= 0.98) return 5;
        if (ratio >= 0.97) return 4;
        if (ratio >= 0.96) return 3;
        if (ratio >= 0.95) return 2;
        if (ratio >= 0.94) return 1;
        return 0;
    }
    private toMaidrawScore(score: NetScore, mode: "refresh" | "classic"): Score {
        const level =
            score.dbChart?.internalLevel ??
            (() => {
                if (score.level.includes("+")) {
                    return parseInt(score.level, 10) + 0.7;
                } else {
                    return parseInt(score.level, 10);
                }
            })();
        const combo = (() => {
            switch (score.combo) {
                case "fc":
                    return ComboLamp.FULL_COMBO;
                case "ab":
                    return ComboLamp.ALL_BREAK;
                case "abp":
                    return ComboLamp.ALL_BREAK_PLUS;
                default:
                    return ComboLamp.NONE;
            }
        })();
        const bell = score.bell === "fb" ? BellLamp.FULL_BELL : BellLamp.NONE;
        return {
            chart: score.dbChart ?? OngekiNetAdapter.fallbackChart(score),
            score: score.score,
            rank: OngekiNetAdapter.getAchievementRank(score.score),
            combo,
            bell,
            rating: OngekiNetAdapter.calculateRating(mode, score.score, level, combo, bell),
            starRating: ONGEKIRating.calculatePlatinum(level, OngekiNetAdapter.getStar(score.platinumScore / score.maxPlatinumScore)),
            platinumScore: score.platinumScore,
        };
    }
    private static calculateRating(mode: "refresh" | "classic", score: number, level: number, combo: ComboLamp, bell: BellLamp) {
        if (mode === "classic") return ONGEKIRating.calculate(score, level);
        const noteLamp: "LOSS" | "CLEAR" | "FULL COMBO" | "ALL BREAK" | "ALL BREAK+" = (() => {
            switch (combo) {
                case ComboLamp.ALL_BREAK_PLUS:
                    return "ALL BREAK+";
                case ComboLamp.ALL_BREAK:
                    return "ALL BREAK";
                case ComboLamp.FULL_COMBO:
                    return "FULL COMBO";
                default:
                    return "CLEAR";
            }
        })();
        try {
            return ONGEKIRating.calculateRefresh(level, score, noteLamp, bell === BellLamp.FULL_BELL);
        } catch {
            return ONGEKIRating.calculate(score, level);
        }
    }
    private static fallbackChart(score: NetScore): Chart {
        return {
            identifier: "0",
            title: score.name,
            artist: "",
            difficulty: score.difficulty as Difficulty,
            level: score.level,
            notes: { tap: 0, hold: 0, side: 0, flick: 0, bell: 0 },
            bpm: [0],
            designer: "-",
            optionalData: {},
            lunatic: score.difficulty === "lunatic" ? LunaticType.LUNATIC : LunaticType.NONE,
            boss: { character: { rarity: "N", name: "", card: "" }, level: 0 },
        };
    }
}
