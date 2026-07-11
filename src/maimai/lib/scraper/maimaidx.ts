import * as tls from "node:tls";
import { BaseGcmError, UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import { Difficulty, Type } from "gcm-database/maimai";
import type { Database } from "gcm-database-otogedb/maimai";
import { type DataOrError, FailedToFetchError } from "maidraw";
import { Agent, fetch } from "undici";
import { CHAINED_CERTIFICATE } from "../chainedCertificate";
import type { NetScore } from "./types";

export type Cookie = Record<string, string>;

export class MaimaiDxNetScraper {
    protected cache = new Cache("maidraw/adapter/maimaidx-net-scraper");

    protected readonly userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
    protected readonly origin: string = "https://maimaidx.jp/";
    protected readonly httpsAgent = new Agent({
        connect: {
            ca: [...tls.rootCertificates, CHAINED_CERTIFICATE],
        },
    });
    protected async fetch(...args: Parameters<typeof fetch>) {
        const res = await fetch(args[0], {
            ...args[1],
            headers: {
                "User-Agent": this.userAgent,
                origin: this.origin,
                ...args[1]?.headers,
            },
            dispatcher: this.httpsAgent,
        });
        return res;
    }

    protected getSetCookie(res: Response) {
        return Object.fromEntries(
            res.headers.getSetCookie().map((cookie) => {
                const [k, v] = cookie.split("=");
                return [k, v];
            }),
        );
    }

    private async getToken() {
        const res = await this.fetch(new URL("/maimai-mobile/", this.origin));
        if (!res.ok) return { err: new FailedToFetchError("maimaidx-net-scraper", "login token") };
        const html = await res.text();
        const $ = Cheerio.load(html);
        const token = $("div.main_wrapper div.see_through_block form div input[name=token]").attr("value");
        const cookies = this.getSetCookie(res);
        return {
            data: {
                cookies,
                token,
            },
        };
    }

    protected readonly errorDescriptionMap: Record<string, string> = {
        "100001": "An unknown error has occurred.",
        "100101": "Sega ID or password is incorrect.",
    };
    protected getErrorPageError(html: string) {
        const $ = Cheerio.load(html);
        const errorCodeText = $($('.main_wrapper [class*="container"] div')[0]).text();
        const errorCode = (/\d{6}/.exec(errorCodeText) ?? [])[0];
        const errorMsg = ($($('.main_wrapper [class*="container"] div')[1]).html() ?? "").replace(/<br\/?>/g, "\n");
        const errorDescription = errorCode && this.errorDescriptionMap[errorCode];
        return new BaseGcmError(
            "maimaidx-net-error",
            `Error code: ${errorCode}. ${errorDescription}

${errorMsg}`,
        );
    }
    // The error detail lives in the server-side session; fetched without the
    // session cookies, the error page only shows a generic "please login again".
    protected async fetchErrorPageError(url: URL, cookies: Record<string, string>) {
        const errorPageRes = await this.fetch(url, {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
            },
        });
        if (!errorPageRes.ok) return new UnknownError();
        return this.getErrorPageError(await errorPageRes.text());
    }

    public async login(username: string, password: string): Promise<DataOrError<Cookie>> {
        const cached = await this.cache.get(`cookielogin-${username}`);
        if (cached) {
            if (await this.checkLogin(cached)) {
                return { data: cached };
            }
        }
        const { data: tData, err: tErr } = await this.getToken();
        if (tErr) return { err: tErr };
        let { token, cookies } = tData;
        const form = new URLSearchParams();
        form.append("segaId", username);
        form.append("password", password);
        form.append("save_cookie", "on");
        form.append("token", token ?? "");
        {
            const res = await this.fetch(new URL("/maimai-mobile/submit/", this.origin), {
                method: "POST",
                body: form,
                headers: {
                    cookie: Object.entries(cookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                    referer: "https://maimaidx.jp/maimai-mobile/",
                },
                redirect: "manual",
            });
            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/maimai-mobile/aimeList/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.startsWith("/maimai-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        {
            const res = await this.fetch("https://maimaidx.jp/maimai-mobile/aimeList/submit/?idx=0", {
                headers: {
                    cookie: Object.entries(cookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                    referer: "https://maimaidx.jp/maimai-mobile/submit/",
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/maimai-mobile/home/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.startsWith("/maimai-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        await this.cache.put(`cookielogin-${username}`, cookies, 15 * 60 * 1000);
        return { data: cookies };
    }

    protected async checkLogin(cookies: Record<string, string>) {
        const res = await this.fetch(new URL("/maimai-mobile/home/", this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/",
            },
            redirect: "manual",
        });
        return res.ok;
    }

    protected async getScores(difficulty: number, cookies: Record<string, string>) {
        const res = await this.fetch(new URL(`/maimai-mobile/record/musicGenre/search/?genre=99&diff=${difficulty}`, this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/record/musicGenre/search/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.maimaidx-scraper", "scores") };

        const charts: NetScore[] = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        for (const e of $("div.main_wrapper .w_450.m_15.p_r.f_0")) {
            const name = $("div form div.music_name_block", e).text();
            const score = parseInt($("div form div.music_score_block.w_112", e).text().trim().replace(".", ""), 10);
            const dxScore = parseInt($("div form div.music_score_block.w_190", e).text().trim().replace(",", ""), 10);
            const maxDxScore = parseInt($("div form div.music_score_block.w_190", e).text().trim().split("/")[1]?.replace(",", ""), 10);
            const level = $("div form div.music_lv_block", e).text();
            const difficulty = ($("div form img.f_l", e).attr("src") ?? "").split("img/diff_")[1]?.split(".png")[0]?.trim();
            const mode = ($("img.music_kind_icon", e).attr("src") ?? "").includes("music_dx") ? "DX" : "ST";
            const attrs = $("div form img.f_r", e);
            const sync = ($(attrs[0]).attr("src") || "").split("img/music_icon_")[1]?.split(".png")[0]?.trim();
            const combo = ($(attrs[1]).attr("src") || "").split("img/music_icon_")[1]?.split(".png")[0]?.trim();
            const achievement = ($(attrs[2]).attr("src") || "").split("img/music_icon_")[1]?.split(".png")[0]?.trim();
            charts.push({
                name,
                level,
                difficulty,
                mode,
                sync,
                combo,
                achievement,
                score,
                dxScore,
                maxDxScore,
            });
        }
        return { data: charts };
    }

    protected readonly newScoreVersion: number = 26000;
    public async getBest50(cookies: Record<string, string>, database: Database) {
        const promises = [];
        for (const difficulty of Object.values(Difficulty)) {
            const difficultyMap = {
                [Difficulty.EASY]: 0,
                [Difficulty.BASIC]: 0,
                [Difficulty.ADVANCED]: 1,
                [Difficulty.EXPERT]: 2,
                [Difficulty.MASTER]: 3,
                [Difficulty.RE_MASTER]: 4,
                [Difficulty.UTAGE]: 10,
            };
            if (difficulty === Difficulty.EASY || difficulty === Difficulty.UTAGE) continue;
            promises.push(
                this.getScores(difficultyMap[difficulty], cookies).then(({ data: scores, err }) => {
                    if (err) return { err };
                    return {
                        data: scores
                            .filter(
                                (v) =>
                                    !Number.isNaN(v.score) &&
                                    !Number.isNaN(v.dxScore) &&
                                    !Number.isNaN(v.maxDxScore) &&
                                    v.combo &&
                                    v.sync &&
                                    v.achievement,
                            )
                            .map(async (v) => {
                                return await database
                                    .searchChart({
                                        title: v.name,
                                        level: parseFloat(v.level),
                                        difficulty,
                                        type: v.mode.toLowerCase() === "dx" ? Type.DELUXE : Type.STANDARD,
                                    })
                                    .then(({ data }) => {
                                        if (data[0]?.chart) v.dbChart = data[0].chart;
                                        return v;
                                    });
                            }),
                    };
                }),
            );
        }
        const scores = await Promise.all(
            (await Promise.all(promises))
                .map(({ data, err }) => {
                    if (err) return null;
                    else return data;
                })
                .filter((v) => !!v)
                .flat(),
        );

        const newScores = scores.filter((v) => {
            if (v.dbChart) {
                const versionNum = parseInt(v.dbChart.optionalData.gameVersion, 10);
                if (!Number.isNaN(versionNum)) {
                    return versionNum >= this.newScoreVersion;
                }
            }
            return true;
        });
        const oldScores = scores.filter((v) => {
            if (v.dbChart) {
                const versionNum = parseInt(v.dbChart.optionalData.gameVersion, 10);
                if (!Number.isNaN(versionNum)) {
                    return versionNum < this.newScoreVersion;
                }
            }
            return false;
        });
        return {
            new: newScores,
            old: oldScores,
        };
    }

    public async getProfile(cookies: Record<string, string>) {
        const res = await this.fetch(new URL("/maimai-mobile/home/", this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/home/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.maimaidx-scraper", "profile") };

        const html = await res.text();
        const $ = Cheerio.load(html);
        const name = $("div.main_wrapper div.see_through_block div.basic_block div.name_block").text();
        const rating = parseInt($("div.main_wrapper div.see_through_block div.rating_block").text(), 10);
        return { data: { name, rating } };
    }
    public async getCharts(level: number, cookies: Record<string, string>) {
        const res = await this.fetch(new URL(`/maimai-mobile/record/musicLevel/search/?level=${level}`, this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/record/musicLevel/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.maimaidx-scraper", "charts") };

        const charts = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        for (const e of $("div.main_wrapper div.pointer form")) {
            const name = $("div.music_name_block", e).text();
            const level = $("div.music_lv_block", e).text();
            const difficulty = ($("img.f_l", e).attr("src") ?? "").split("img/diff_")[1].split(".png")[0];
            const mode = ($("img.music_kind_icon", e).attr("src") ?? "").includes("music_dx") ? "DX" : "ST";
            charts.push({ name, level, difficulty, mode });
        }
        return { data: charts };
    }
}
