import * as tls from "node:tls";
import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import { Difficulty, Type } from "gcm-database/maimai";
import type { Database } from "gcm-database-otogedb/maimai";
import { Agent, fetch as nodeFetch } from "undici";
import { CHAINED_CERTIFICATE } from "../chainedCertificate";
import type { NetScore } from "./types";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const headers = {
    "User-Agent": UA,
    origin: "https://maimaidx.jp",
};

const HTTPS_AGENT = new Agent({
    connect: {
        ca: [...tls.rootCertificates, CHAINED_CERTIFICATE],
    },
});

async function fetch(...args: Parameters<typeof nodeFetch>) {
    const res = await nodeFetch(args[0], {
        ...args[1],
        dispatcher: HTTPS_AGENT,
    });
    return res;
}

export async function getToken() {
    const res = await fetch("https://maimaidx.jp/maimai-mobile/", {
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

const cache = new Cache("maidraw/adapter/maimaidx-net-scraper");
export async function login(username: string, password: string) {
    const cached = await cache.get(`cookielogin-${username}`);
    if (cached) {
        if (await checkLogin(cached)) {
            return cached;
        }
    }
    const res = await getToken();
    if (!res) return null;
    const { token, cookies } = res;
    const form = new URLSearchParams();
    form.append("segaId", username);
    form.append("password", password);
    form.append("save_cookie", "on");
    form.append("token", token ?? "");
    {
        const res = await fetch("https://maimaidx.jp/maimai-mobile/submit/", {
            method: "POST",
            body: form,
            headers: {
                ...headers,
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/",
            },
            redirect: "manual",
        });
        if (!(res.status >= 300 && res.status < 400)) return null;

        for (const setCookie of res.headers.getSetCookie()) {
            const [k, v] = setCookie.split(";")[0].split("=");
            cookies[k] = v;
        }
    }
    {
        const res = await fetch("https://maimaidx.jp/maimai-mobile/aimeList/submit/?idx=0", {
            headers: {
                ...headers,
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("; "),
                referer: "https://maimaidx.jp/maimai-mobile/submit/",
            },
            redirect: "manual",
        });
        if (!(res.status >= 300 && res.status < 400)) return null;
        for (const [key, value] of res.headers) {
            if (key.toLowerCase() === "set-cookie") {
                const [k, v] = value.split(";")[0].split("=");
                cookies[k] = v;
            }
        }
    }
    await cache.put(`cookielogin-${username}`, cookies, 15 * 60 * 1000);
    return cookies;
}

export async function getScores(difficulty: number, cookies: Record<string, string>) {
    const res = await fetch(`https://maimaidx.jp/maimai-mobile/record/musicGenre/search/?genre=99&diff=${difficulty}`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx.jp/maimai-mobile/record/musicGenre/search/",
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
    const res = await fetch(`https://maimaidx.jp/maimai-mobile/home/`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx.jp/maimai-mobile/home/",
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
    const res = await fetch(`https://maimaidx.jp/maimai-mobile/record/musicLevel/search/?level=${level}`, {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx.jp/maimai-mobile/record/musicLevel/",
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
    const res = await fetch("https://maimaidx.jp/maimai-mobile/home/", {
        headers: {
            ...headers,
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join("; "),
            referer: "https://maimaidx.jp/maimai-mobile/",
        },
        redirect: "manual",
    });
    return res.ok;
}
