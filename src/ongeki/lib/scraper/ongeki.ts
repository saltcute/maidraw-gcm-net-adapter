import { BaseGcmError, UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import { Difficulty } from "gcm-database/ongeki";
import type { Database } from "gcm-database-otogedb/ongeki";
import { type DataOrError, FailedToFetchError } from "maidraw";
import { fetch } from "undici";
import type { NetScore, RecentScore } from "./types";

export type Cookie = Record<string, string>;

export class OngekiNetScraper {
    protected cache = new Cache("maidraw/adapter/ongeki-net-scraper");

    protected readonly userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
    protected readonly origin: string = "https://ongeki-net.com/";
    protected async fetch(...args: Parameters<typeof fetch>) {
        const res = await fetch(args[0], {
            ...args[1],
            headers: {
                "User-Agent": this.userAgent,
                origin: this.origin,
                ...args[1]?.headers,
            },
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
        const res = await this.fetch(new URL("/ongeki-mobile/", this.origin));
        if (!res.ok) return { err: new FailedToFetchError("ongeki-net-scraper", "login token") };
        const html = await res.text();
        const $ = Cheerio.load(html);
        const token = $("form[action$='submit/'] input[name=token]").attr("value");
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
            "ongeki-net-error",
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
            const res = await this.fetch(new URL("/ongeki-mobile/submit/", this.origin), {
                method: "POST",
                body: form,
                headers: {
                    cookie: Object.entries(cookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                    referer: "https://ongeki-net.com/ongeki-mobile/",
                },
                redirect: "manual",
            });
            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/ongeki-mobile/aimeList/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.startsWith("/ongeki-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        {
            const res = await this.fetch("https://ongeki-net.com/ongeki-mobile/aimeList/submit/?idx=0", {
                headers: {
                    cookie: Object.entries(cookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                    referer: "https://ongeki-net.com/ongeki-mobile/submit/",
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/ongeki-mobile/home/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.startsWith("/ongeki-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        await this.cache.put(`cookielogin-${username}`, cookies, 15 * 60 * 1000);
        return { data: cookies };
    }

    protected async checkLogin(cookies: Record<string, string>) {
        const res = await this.fetch(new URL("/ongeki-mobile/home/", this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://ongeki-net.com/ongeki-mobile/",
            },
            redirect: "manual",
        });
        return res.ok;
    }

    private parseIcons(icons: string[]) {
        let rank = "";
        let bell = "";
        let combo = "";
        for (const icon of icons) {
            if (icon.startsWith("tr_")) rank = icon.replace("tr_", "");
            else if (icon === "fb") bell = icon;
            else if (icon === "fc" || icon === "ab" || icon === "abp") combo = icon;
        }
        return { rank, bell, combo };
    }

    protected async getScores(difficulty: number, cookies: Record<string, string>) {
        const res = await this.fetch(new URL(`/ongeki-mobile/record/musicGenre/search/?genre=99&diff=${difficulty}`, this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://ongeki-net.com/ongeki-mobile/record/musicGenre/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.ongeki-scraper", "scores") };

        const charts: NetScore[] = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        for (const e of $("div.main_wrapper form[action$='musicDetail/']")) {
            const table = $("table.score_table", e).first();
            const score = parseInt($("td.score_value", table).eq(2).text().trim().replace(/,/g, ""), 10);
            if (Number.isNaN(score)) continue;
            const name = $("div.music_label", e).text().trim();
            const level = $("div.score_level", e).text().trim();
            const difficulty = ($("img[src*='img/diff_']", e).attr("src") ?? "").split("img/diff_")[1]?.split(".png")[0]?.trim();
            const [platinumScore, maxPlatinumScore] = $("div.platinum_high_score_text_block", e)
                .text()
                .trim()
                .split("/")
                .map((v) => parseInt(v.replace(/,/g, ""), 10));
            const icons = $("div.music_score_icon_area img", e)
                .map((_, img) => ($(img).attr("src") ?? "").split("img/music_icon_")[1]?.split(".png")[0]?.trim())
                .get();
            const { rank, bell, combo } = this.parseIcons(icons);
            charts.push({
                name,
                level,
                difficulty,
                rank,
                bell,
                combo,
                score,
                platinumScore,
                maxPlatinumScore,
            });
        }
        return { data: charts };
    }

    protected readonly difficultyMap: Record<Difficulty, number> = {
        [Difficulty.BASIC]: 0,
        [Difficulty.ADVANCED]: 1,
        [Difficulty.EXPERT]: 2,
        [Difficulty.MASTER]: 3,
        [Difficulty.LUNATIC]: 10,
    };
    protected readonly versionMap: Record<string, number> = {
        // biome-ignore lint/style/useNamingConvention: game version names
        ONGEKI: 100,
        "ONGEKI Plus": 105,
        // biome-ignore lint/style/useNamingConvention: game version names
        SUMMER: 110,
        "SUMMER Plus": 115,
        // biome-ignore lint/style/useNamingConvention: game version names
        RED: 120,
        "RED Plus": 125,
        bright: 130,
        "bright MEMORY Act.1": 135,
        "bright MEMORY Act.2": 140,
        "bright MEMORY Act.3": 145,
        "Re:Fresh": 150,
    };
    protected readonly newScoreVersion: number = 150;
    private isNewVersion(score: NetScore) {
        if (!score.dbChart) return true;
        const version = this.versionMap[score.dbChart.optionalData.gameVersion];
        if (version === undefined) return true;
        return version >= this.newScoreVersion;
    }

    public async getBest(cookies: Record<string, string>, database: Database) {
        const promises = [];
        for (const difficulty of Object.values(Difficulty)) {
            promises.push(
                this.getScores(this.difficultyMap[difficulty], cookies).then(({ data: scores, err }) => {
                    if (err) return { err };
                    return {
                        data: scores.map(async (v) => {
                            return await database
                                .searchChart({
                                    title: v.name,
                                    level: parseFloat(v.level),
                                    difficulty,
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

        return {
            new: scores.filter((v) => this.isNewVersion(v)),
            old: scores.filter((v) => !this.isNewVersion(v)),
        };
    }

    public async getRecent(cookies: Record<string, string>): Promise<DataOrError<RecentScore[]>> {
        const res = await this.fetch(new URL("/ongeki-mobile/record/playlog/", this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://ongeki-net.com/ongeki-mobile/home/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.ongeki-scraper", "recent scores") };

        const scores: RecentScore[] = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        for (const e of $("div.main_wrapper form[action$='playlogDetail/']")) {
            const block = $(e).parent();
            const name = $("div.l_h_10.break", block).text().trim();
            const difficulty = ($("img[src*='img/diff_']", block).attr("src") ?? "").split("img/diff_")[1]?.split(".png")[0]?.trim();
            const score = parseInt($("td.technical_score_block div", block).last().text().trim().replace(/,/g, ""), 10);
            if (Number.isNaN(score)) continue;
            const rank = ($("img[src*='img/score_tr_']", block).attr("src") ?? "").split("img/score_tr_")[1]?.split(".png")[0]?.trim();
            const details = $("div.f_0 img[src*='img/score_detail_']", block)
                .map((_, img) => ($(img).attr("src") ?? "").split("img/score_detail_")[1]?.split(".png")[0]?.trim())
                .get();
            const bell = details.includes("fb") ? "fb" : "";
            const combo = details.includes("abp") ? "abp" : details.includes("ab") ? "ab" : details.includes("fc") ? "fc" : "";
            scores.push({ name, difficulty, score, rank, bell, combo });
        }
        return { data: scores };
    }

    public async getProfile(cookies: Record<string, string>) {
        const res = await this.fetch(new URL("/ongeki-mobile/home/", this.origin), {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://ongeki-net.com/ongeki-mobile/home/",
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.ongeki-scraper", "profile") };

        const html = await res.text();
        const $ = Cheerio.load(html);
        const name = $("div.main_wrapper div.name_block").text().trim();
        const rating = parseFloat($("div.main_wrapper div.rating_field span.rating_shadow").text().trim());
        return { data: { name, rating } };
    }
}
