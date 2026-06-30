import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import { Difficulty, Type } from "gcm-database/maimai";
import type { Database } from "gcm-database-otogedb/maimai";
import { fetch as nodeFetch } from "undici";
import type { NetScore } from "./types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const headers = {
    "User-Agent": UA,
    origin: "https://maimaidx-eng",
};

async function fetch(...args: Parameters<typeof nodeFetch>) {
    const res = await nodeFetch(...args);
    return res;
}

export async function getToken() {
    const res = await fetch("https://maimaidx-eng.com/maimai-mobile/", {
        headers: headers,
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = Cheerio.load(html);
    const token = $("div.main_wrapper div.see_through_block form div input[name=token]").attr("value");
    const cookies: Record<string, string> = {};
    for (const [key, value] of res.headers) {
        if (key.toLowerCase() === "set-cookie") {
            const [k, v] = value.split(";")[0].split("=");
            cookies[k] = v;
        }
    }
    return {
        cookies,
        token,
    };
}

const cache = new Cache("maidraw/adapter/maimaidx-net-eng-scraper");
export async function login(username: string, password: string) {
    const cached = await cache.get(`cookielogin-${username}`);
    if (cached) {
        if (await checkLogin(cached)) {
            return cached;
        }
    }
    const form = new URLSearchParams();
    form.append("sid", username);
    form.append("password", password);
    form.append("retention", "1");
    {
        const loginCookies: Record<string, string> = {};
        const loginReq = await fetch(
            "https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/",
            {
                method: "POST",
                body: form,
                headers: {
                    "User-Agent": headers["User-Agent"],
                    referer: "https://maimaidx-eng.com/",
                },
                redirect: "manual",
            },
        );
        if (!(loginReq.status >= 200 && loginReq.status < 300)) return null;

        for (const setCookie of loginReq.headers.getSetCookie()) {
            const [k, v] = setCookie.split(";")[0].split("=");
            loginCookies[k] = v;
        }
        const oauthReq = await fetch("https://lng-tgk-aime-gw.am-all.net/common_auth/login/sid", {
            method: "POST",
            body: form,
            headers: {
                "User-Agent": headers["User-Agent"],
                referer:
                    "https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/",

                cookie: Object.entries(loginCookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
            },
            redirect: "manual",
        });
        if (!(oauthReq.status >= 300 && oauthReq.status < 400)) return null;

        const getTokenLocation = oauthReq.headers.get("location");
        if (!getTokenLocation) return null;

        for (const setCookie of oauthReq.headers.getSetCookie()) {
            const [k, v] = setCookie.split(";")[0].split("=");
            loginCookies[k] = v;
        }

        const getTokenCookies: Record<string, string> = {};
        const getTokenReq = await fetch(getTokenLocation, {
            method: "GET",
            headers: {
                "User-Agent": headers["User-Agent"],
                referer: "https://lng-tgk-aime-gw.am-all.net/",
                cookie: Object.entries(loginCookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
            },
            redirect: "manual",
        });

        if (!(getTokenReq.status >= 300 && getTokenReq.status < 400)) return null;

        for (const setCookie of getTokenReq.headers.getSetCookie()) {
            const [k, v] = setCookie.split(";")[0].split("=");
            getTokenCookies[k] = v;
        }

        await cache.put(`cookielogin-${username}`, getTokenCookies, 15 * 60 * 1000);
        return getTokenCookies;
    }
}

export async function getScores(difficulty: number, cookies: Record<string, string>) {
    const res = await fetch(`https://maimaidx-eng.com/maimai-mobile/record/musicGenre/search/?genre=99&diff=${difficulty}`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx-eng.com/maimai-mobile/record/musicGenre/search/",
        },
    });
    if (!res.ok) throw await res.text();
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
    return charts;
}

const NEW_SCORE_VERSION = 26000;
export async function getBest50(cookies: Record<string, string>, database: Database) {
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
            getScores(difficultyMap[difficulty], cookies).then((scores) => {
                return scores
                    .filter(
                        (v) =>
                            !Number.isNaN(v.score) && !Number.isNaN(v.dxScore) && !Number.isNaN(v.maxDxScore) && v.combo && v.sync && v.achievement,
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
                                if (data[0].chart) v.dbChart = data[0].chart;
                                return v;
                            });
                    });
            }),
        );
    }
    const scores = await Promise.all((await Promise.all(promises)).flat());
    const newScores = scores.filter((v) => {
        if (v.dbChart) {
            const versionNum = parseInt(v.dbChart.optionalData.gameVersion, 10);
            if (!Number.isNaN(versionNum)) {
                return versionNum >= NEW_SCORE_VERSION;
            }
        }
        return true;
    });
    const oldScores = scores.filter((v) => {
        if (v.dbChart) {
            const versionNum = parseInt(v.dbChart.optionalData.gameVersion, 10);
            if (!Number.isNaN(versionNum)) {
                return versionNum < NEW_SCORE_VERSION;
            }
        }
        return false;
    });
    return {
        new: newScores,
        old: oldScores,
    };
}

export async function getProfile(cookies: Record<string, string>) {
    const res = await fetch(`https://maimaidx-eng.com/maimai-mobile/home/`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx-eng.com/maimai-mobile/home/",
        },
    });
    if (!res.ok) throw await res.text();
    const html = await res.text();
    const $ = Cheerio.load(html);
    const name = $("div.main_wrapper div.see_through_block div.basic_block div.name_block").text();
    const rating = parseInt($("div.main_wrapper div.see_through_block div.rating_block").text(), 10);
    return { name, rating };
}
export async function getCharts(level: number, cookies: Record<string, string>) {
    const res = await fetch(`https://maimaidx-eng.com/maimai-mobile/record/musicLevel/search/?level=${level}`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx-eng.com/maimai-mobile/record/musicLevel/",
        },
    });
    if (!res.ok) throw await res.text();
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
    return charts;
}

export async function checkLogin(cookies: Record<string, string>) {
    const res = await fetch("https://maimaidx-eng.com/maimai-mobile/home/", {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx-eng.com/maimai-mobile/",
        },
        redirect: "manual",
    });
    return res.ok;
}
