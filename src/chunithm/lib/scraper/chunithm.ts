import { BaseGcmError, UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import { Difficulty } from "gcm-database/chunithm";
import type { Database } from "gcm-database-otogedb/chunithm";
import { type DataOrError, FailedToFetchError } from "maidraw";
import { fetch } from "undici";
import type { NetScore } from "./types";

export type Cookie = Record<string, string>;

export class ChunithmNetScraper {
    protected cache = new Cache("maidraw/adapter/chunithm-net-scraper");

    protected readonly userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
    protected readonly origin: string = "https://new.chunithm-net.com/";
    protected readonly mobile: string = "chuni-mobile/html/mobile";
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

    protected url(path: string) {
        return new URL(`/${this.mobile}/${path}`, this.origin);
    }
    protected cookieHeader(cookies: Record<string, string>) {
        return Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ");
    }

    protected getSetCookie(res: Response) {
        return Object.fromEntries(
            res.headers.getSetCookie().map((cookie) => {
                const [k, v] = cookie.split(";")[0].split("=");
                return [k, v];
            }),
        );
    }

    private async getToken() {
        const res = await this.fetch(this.url(""));
        if (!res.ok) return { err: new FailedToFetchError("chunithm-net-scraper", "login token") };
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
        "100106": "You have to play on the latest version at least once to use CHUNITHM-NET",
    };
    protected getErrorPageError(html: string) {
        const $ = Cheerio.load(html);
        const paragraphs = $("div#inner .box01 p");
        const errorCodeText = $(paragraphs[0]).text();
        const errorCode = (/\d{6}/.exec(errorCodeText) ?? [])[0];
        const errorMsg = ($(paragraphs[1]).html() ?? "").replace(/<br\/?>/g, "\n");
        const errorDescription = errorCode && this.errorDescriptionMap[errorCode];
        return new BaseGcmError(
            "chunithm-net-error",
            `Error code: ${errorCode}. ${errorDescription}

${errorMsg}`,
        );
    }
    // The error detail lives in the server-side session; fetched without the
    // session cookies, the error page only shows a generic "please login again".
    protected async fetchErrorPageError(url: URL, cookies: Record<string, string>) {
        const errorPageRes = await this.fetch(url, {
            headers: { cookie: this.cookieHeader(cookies) },
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
            const res = await this.fetch(this.url("submit/"), {
                method: "POST",
                body: form,
                headers: {
                    cookie: this.cookieHeader(cookies),
                    referer: this.url("").toString(),
                },
                redirect: "manual",
            });
            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.endsWith("/aimeList/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.includes("/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        {
            const aimeForm = new URLSearchParams();
            aimeForm.append("idx", "0");
            aimeForm.append("token", cookies._t ?? token ?? "");
            const res = await this.fetch(this.url("aimeList/submit/"), {
                method: "POST",
                body: aimeForm,
                headers: {
                    cookie: this.cookieHeader(cookies),
                    referer: this.url("aimeList/").toString(),
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.endsWith("/home/")) {
                cookies = {
                    ...cookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.includes("/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
        await this.cache.put(`cookielogin-${username}`, cookies, 15 * 60 * 1000);
        return { data: cookies };
    }

    protected async checkLogin(cookies: Record<string, string>) {
        const res = await this.fetch(this.url("home/"), {
            headers: {
                cookie: this.cookieHeader(cookies),
                referer: this.url("").toString(),
            },
            redirect: "manual",
        });
        return res.ok;
    }

    private parseLamps(icons: string[]) {
        let clear = "";
        let combo = "";
        let chain = "";
        for (const icon of icons) {
            switch (icon) {
                case "clear":
                case "failed":
                case "hard":
                case "brave":
                case "absolute":
                case "catastrophy":
                    clear = icon;
                    break;
                case "fullcombo":
                case "alljustice":
                case "alljusticecritical":
                    combo = icon;
                    break;
                case "fullchain":
                case "fullchain2":
                    chain = icon;
                    break;
            }
        }
        return { clear, combo, chain };
    }

    protected readonly difficultyMap: Record<Difficulty, string> = {
        [Difficulty.BASIC]: "Basic",
        [Difficulty.ADVANCED]: "Advanced",
        [Difficulty.EXPERT]: "Expert",
        [Difficulty.MASTER]: "Master",
        [Difficulty.ULTIMA]: "Ultima",
        [Difficulty.WORLDS_END]: "WorldsEnd",
    };
    protected async getScores(difficulty: Difficulty, cookies: Record<string, string>, database: Database) {
        const name = this.difficultyMap[difficulty];
        const form = new URLSearchParams();
        form.append("genre", "99");
        form.append("token", cookies._t ?? "");
        const stateRes = await this.fetch(this.url(`record/musicGenre/send${name}/`), {
            method: "POST",
            body: form,
            headers: {
                cookie: this.cookieHeader(cookies),
                referer: this.url("record/musicGenre/").toString(),
            },
            redirect: "manual",
        });
        if (stateRes.status >= 400) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.chunithm-scraper", "scores") };

        const res = await this.fetch(this.url(`record/musicGenre/${name.toLowerCase()}`), {
            headers: {
                cookie: this.cookieHeader(cookies),
                referer: this.url("record/musicGenre/").toString(),
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.chunithm-scraper", "scores") };

        const charts: NetScore[] = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        for (const e of $("form[action$='sendMusicDetail/']")) {
            const highscore = $("div.play_musicdata_highscore span.text_b", e);
            if (highscore.length <= 0) continue;
            const score = parseInt(highscore.text().trim().replace(/,/g, ""), 10);
            if (Number.isNaN(score)) continue;
            const name = $("div.music_title", e).text().trim();
            const idx = $("input[name=idx]", e).attr("value") ?? "";
            const icons = $("div.play_musicdata_icon img", e)
                .map((_, img) => ($(img).attr("src") ?? "").split("images/icon_")[1]?.split(".png")[0]?.trim())
                .get();
            const { clear, combo, chain } = this.parseLamps(icons);
            const chart: NetScore = {
                name,
                difficulty,
                clear,
                combo,
                chain,
                score,
            };
            const { data: dbChart } = await database.getChart(idx, difficulty);
            if (dbChart) chart.dbChart = dbChart;
            charts.push(chart);
        }
        return { data: charts };
    }

    protected readonly versionMap: Record<string, number> = {
        // biome-ignore lint/style/useNamingConvention: game version names
        無印: 100,
        // biome-ignore lint/style/useNamingConvention: game version names
        PLUS: 105,
        // biome-ignore lint/style/useNamingConvention: game version names
        AIR: 110,
        "AIR+": 115,
        // biome-ignore lint/style/useNamingConvention: game version names
        STAR: 120,
        "STAR+": 125,
        // biome-ignore lint/style/useNamingConvention: game version names
        AMAZON: 130,
        "AMAZON+": 135,
        // biome-ignore lint/style/useNamingConvention: game version names
        CRYSTAL: 140,
        "CRYSTAL+": 145,
        // biome-ignore lint/style/useNamingConvention: game version names
        PARADISE: 150,
        "PARADISE×": 155,
        // biome-ignore lint/style/useNamingConvention: game version names
        NEW: 200,
        "NEW+": 205,
        // biome-ignore lint/style/useNamingConvention: game version names
        SUN: 210,
        "SUN+": 215,
        // biome-ignore lint/style/useNamingConvention: game version names
        LUMINOUS: 220,
        "LUMINOUS+": 225,
        // biome-ignore lint/style/useNamingConvention: game version names
        VERSE: 230,
        "X-VERSE": 240,
        "X-VERSE-X": 245,
        // biome-ignore lint/style/useNamingConvention: game version names
        MATE: 250,
    };
    protected readonly newScoreVersion: number = 250;
    private isNewVersion(score: NetScore) {
        if (!score.dbChart) return true;
        const version = this.versionMap[score.dbChart.optionalData.gameVersion];
        if (version === undefined) return true;
        return version >= this.newScoreVersion;
    }

    public async getBest(cookies: Record<string, string>, database: Database) {
        const scores: NetScore[] = [];
        for (const difficulty of [Difficulty.BASIC, Difficulty.ADVANCED, Difficulty.EXPERT, Difficulty.MASTER, Difficulty.ULTIMA]) {
            const { data, err } = await this.getScores(difficulty, cookies, database);
            if (err) continue;
            scores.push(...data);
        }
        return {
            new: scores.filter((v) => this.isNewVersion(v)),
            old: scores.filter((v) => !this.isNewVersion(v)),
        };
    }

    public async getRecent(cookies: Record<string, string>, database: Database): Promise<DataOrError<NetScore[]>> {
        const res = await this.fetch(this.url("record/playlog/"), {
            headers: {
                cookie: this.cookieHeader(cookies),
                referer: this.url("home/").toString(),
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.chunithm-scraper", "recent scores") };

        const scores: NetScore[] = [];
        const html = await res.text();
        const $ = Cheerio.load(html);
        const difficultyMap: Record<string, Difficulty> = {
            basic: Difficulty.BASIC,
            advanced: Difficulty.ADVANCED,
            expert: Difficulty.EXPERT,
            master: Difficulty.MASTER,
            ultima: Difficulty.ULTIMA,
            worldsend: Difficulty.WORLDS_END,
        };
        for (const e of $("div.play_musicdata_block")) {
            const block = $(e).parent();
            const name = $("div.play_musicdata_title", e).text().trim();
            const score = parseInt($("div.play_musicdata_score_text", e).text().trim().replace(/,/g, ""), 10);
            if (Number.isNaN(score)) continue;
            const difficultyName = ($("div.play_track_result img", block).attr("src") ?? "").split("images/musiclevel_")[1]?.split(".png")[0]?.trim();
            const difficulty = difficultyMap[difficultyName ?? ""];
            if (!difficulty) continue;
            const icons = $("div.play_musicdata_icon img", block)
                .map((_, img) => ($(img).attr("src") ?? "").split("images/icon_")[1]?.split(".png")[0]?.trim())
                .get();
            const { clear, combo, chain } = this.parseLamps(icons);
            const chart: NetScore = {
                name,
                difficulty,
                clear,
                combo,
                chain,
                score,
            };
            const { data } = await database.searchChart({ title: name, level: 0, difficulty });
            if (data[0]?.chart) chart.dbChart = data[0].chart;
            scores.push(chart);
        }
        return { data: scores };
    }

    public async getProfile(cookies: Record<string, string>) {
        const res = await this.fetch(this.url("home/"), {
            headers: {
                cookie: this.cookieHeader(cookies),
                referer: this.url("home/").toString(),
            },
        });
        if (!res.ok) return { err: new FailedToFetchError("maidraw.adapter.gcm-net.chunithm-scraper", "profile") };

        const html = await res.text();
        const $ = Cheerio.load(html);
        const name = $("div.player_name div.player_name_in").text().trim();
        const rating = parseFloat(
            $("div.player_rating div.player_rating_num_block img")
                .map((_, img) => {
                    const digit = ($(img).attr("src") ?? "").split("images/rating/rating_")[1]?.split(".png")[0]?.split("_")[1];
                    if (digit === undefined) return "";
                    if (digit === "comma") return ".";
                    return `${parseInt(digit, 10)}`;
                })
                .get()
                .join(""),
        );
        return { data: { name, rating } };
    }
}
