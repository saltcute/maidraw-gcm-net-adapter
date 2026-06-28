import { Crypto } from "@common/crypto";
import { FailedToAuthenticateError, FailedToDecryptError } from "@common/error";
import { type Difficulty, Type } from "gcm-database/maimai";
import type { Database } from "gcm-database-otogedb/maimai";
import type Kasumi from "kasumi.js";
import { BaseScoreAdapter, FailedToFetchError } from "maidraw";
import { AchievementTypes, ComboLamp, type MaimaiScoreAdapter, type Score, SyncLamp } from "maidraw/maimai";
import { MaimaiDXRate } from "rg-stats";
import * as MaimaiDxNetScraper from "./lib/scraper/maimaidx-eng";

export class MaimaiDxNetEngAdapter extends BaseScoreAdapter implements MaimaiScoreAdapter {
    async getPlayerInfo(token: string) {
        if (!Crypto.global) Crypto.global = await Crypto.new(this.kasumi);
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: FailedToDecryptError };
        const { segaId, password } = decrypted;
        const cached = await this.cache.get(`profile-${segaId}`);
        if (cached?.data) return cached;
        const cookies = await MaimaiDxNetScraper.login(segaId, password);
        if (!cookies)
            return {
                err: new FailedToAuthenticateError(),
            };
        const { data: b50, err } = await this.getPlayerBest50(token);
        if (err) return { err };
        const profile = await MaimaiDxNetScraper.getProfile(cookies);
        if (!profile) return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "profile") };
        const res = {
            name: profile.name,
            rating: b50.new.concat(b50.old).reduce((a, b) => a + Math.trunc(b.dxRating), 0),
        };
        this.cache.put(`profile-${segaId}`, res, 5 * 60 * 1000);
        return { data: res };
    }
    async getPlayerProfilePicture(_token: string) {
        return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "profile picture", "Unsupported") };
    }
    async getPlayerScore(_token: string, _chartIdentifier: string) {
        return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "profile picture", "Unsupported") };
    }
    async getPlayerLevel50(_username: string, _level: number, _page: number, _options?: { percise: boolean }) {
        return { err: new FailedToFetchError("maidraw.adapter.gcm-net", "profile picture", "Unsupported") };
    }
    private database: Database;
    private kasumi: Kasumi;
    constructor({
        kasumi,
        database,
    }: {
        kasumi: Kasumi;
        database: Database;
    }) {
        super({ name: "maimaidx-net-eng-adapter" });
        this.kasumi = kasumi;
        this.database = database;
    }

    async getPlayerBest50(token: string) {
        if (!Crypto.global) Crypto.global = await Crypto.new(this.kasumi);
        const decrypted = await Crypto.global.decrypt(token);
        if (!decrypted) return { err: new FailedToDecryptError() };
        const { segaId, password } = decrypted;
        const cached = await this.cache.get(`best50-${segaId}`);
        if (cached) return { data: cached as { new: Score[]; old: Score[] } };
        const cookies = await MaimaiDxNetScraper.login(segaId, password);
        if (!cookies) return { err: new FailedToAuthenticateError() };
        const rawBest50 = await MaimaiDxNetScraper.getBest50(cookies, this.database);
        const b50 = {
            new: rawBest50.new
                .map((v) => this.toMaidrawScore(v))
                .sort((a, b) => b.dxRating - a.dxRating || b.achievement - a.achievement)
                .slice(0, 15),
            old: rawBest50.old
                .map((v) => this.toMaidrawScore(v))
                .sort((a, b) => b.dxRating - a.dxRating || b.achievement - a.achievement)
                .slice(0, 35),
        };
        this.cache.put(`best50-${segaId}`, b50, 5 * 60 * 1000);
        return { data: b50 };
    }

    private static getAchievmentRank(achivement: number) {
        if (achivement >= 1005000) return AchievementTypes.SSSP;
        else if (achivement >= 1000000) return AchievementTypes.SSS;
        else if (achivement >= 995000) return AchievementTypes.SSP;
        else if (achivement >= 990000) return AchievementTypes.SS;
        else if (achivement >= 980000) return AchievementTypes.SP;
        else if (achivement >= 970000) return AchievementTypes.S;
        else if (achivement >= 940000) return AchievementTypes.AAA;
        else if (achivement >= 900000) return AchievementTypes.AA;
        else if (achivement >= 800000) return AchievementTypes.A;
        else if (achivement >= 750000) return AchievementTypes.BBB;
        else if (achivement >= 700000) return AchievementTypes.BB;
        else if (achivement >= 600000) return AchievementTypes.B;
        else if (achivement >= 500000) return AchievementTypes.C;
        else return AchievementTypes.D;
    }
    private toMaidrawScore(score: MaimaiDxNetScraper.NetScore): Score {
        const level =
            score.dbChart?.internalLevel ??
            (() => {
                if (score.level.includes("+")) {
                    return parseInt(score.level, 10) + 0.6;
                } else {
                    return parseInt(score.level, 10);
                }
            })();
        const achievement = score.score / 10000;
        return {
            chart: score.dbChart
                ? score.dbChart
                : {
                      identifier: "0",
                      title: score.name,
                      difficulty: (() => {
                          return score.difficulty as Difficulty;
                      })(),
                      type: score.mode === "dx" ? Type.DELUXE : Type.STANDARD,
                      artist: "",
                      level: score.level,
                      bpm: [0],
                      designer: "-",
                      notes: {
                          tap: 0,
                          hold: 0,
                          slide: 0,
                          touch: 0,
                          break: 0,
                      },
                      optionalData: {},
                  },
            achievement,
            achievementRank: MaimaiDxNetEngAdapter.getAchievmentRank(score.score),
            dxRating: MaimaiDXRate.calculate(
                achievement,
                level,
                score.combo.includes("ap") ? `ALL PERFECT${achievement >= 101 ? "+" : ""}` : "CLEAR",
            ),
            dxScore: score.dxScore,
            combo: (() => {
                switch (score.combo) {
                    case "fc":
                        return ComboLamp.FULL_COMBO;
                    case "fcp":
                        return ComboLamp.FULL_COMBO_PLUS;
                    case "ap":
                        return ComboLamp.ALL_PERFECT;
                    case "app":
                        return ComboLamp.ALL_PERFECT_PLUS;
                    default:
                        return ComboLamp.NONE;
                }
            })(),
            sync: (() => {
                switch (score.combo) {
                    case "sync":
                        return SyncLamp.SYNC_PLAY;
                    case "fs":
                        return SyncLamp.FULL_SYNC;
                    case "fsp":
                        return SyncLamp.FULL_SYNC_PLUS;
                    case "fdx":
                        return SyncLamp.FULL_SYNC_DX;
                    case "fdxp":
                        return SyncLamp.FULL_SYNC_DX_PLUS;
                    default:
                        return SyncLamp.NONE;
                }
            })(),
        };
    }
}
