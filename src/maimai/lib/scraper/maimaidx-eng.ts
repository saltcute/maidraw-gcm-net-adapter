import { BaseGcmError, UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import * as Cheerio from "cheerio";
import type { DataOrError } from "maidraw";
import { type Cookie, MaimaiDxNetScraper } from "./maimaidx";

export class MaimaiDxNetEngScraper extends MaimaiDxNetScraper {
    protected readonly origin = "https://maimaidx-eng.com/";
    protected readonly newScoreVersion = 26000;

    protected cache = new Cache("maidraw/adapter/maimaidx-net-eng-scraper");
    public async login(username: string, password: string): Promise<DataOrError<Cookie>> {
        const cached = await this.cache.get(`cookielogin-${username}`);
        if (cached) {
            if (await this.checkLogin(cached)) {
                return { data: cached };
            }
        }
        let loginCookies: Record<string, string> = {};
        {
            const res = await this.fetch(
                "https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/",
                {
                    headers: {
                        referer: undefined,
                    },
                },
            );
            if (!(res.status >= 200 && res.status < 300)) return { err: new UnknownError("unexpected redirection status at login.") };

            loginCookies = this.getSetCookie(res);
        }
        let getTokenLocation: string;
        {
            const form = new URLSearchParams();
            form.append("sid", username);
            form.append("password", password);
            form.append("retention", "1");
            const res = await fetch("https://lng-tgk-aime-gw.am-all.net/common_auth/login/sid", {
                method: "POST",
                body: form,
                headers: {
                    referer:
                        "https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=maimaidxex&redirect_url=https://maimaidx-eng.com/maimai-mobile/&back_url=https://maimai.sega.com/",
                    cookie: Object.entries(loginCookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/maimai-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...loginCookies, ...this.getSetCookie(res) }) };
            } else if (url?.pathname.startsWith("/maimai-mobile")) {
                loginCookies = {
                    ...loginCookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.includes("/common_auth/login")) {
                try {
                    const intlErrorPage = await this.fetch(url, {
                        headers: {
                            referer: "https://lng-tgk-aime-gw.am-all.net/",
                            cookie: Object.entries({
                                ...loginCookies,
                                ...this.getSetCookie(res),
                            })
                                .map(([k, v]) => `${k}=${v}`)
                                .join("; "),
                        },
                    });
                    const $ = Cheerio.load(await intlErrorPage.text());
                    const errorText = $("#error-ui").text();
                    if (!errorText) throw "";
                    return { err: new BaseGcmError("aime-auth-error", `failed to login. ${errorText}`) };
                } catch {
                    return { err: new UnknownError(`unexpected login status. Did you enter your Sega ID and password correctly?`) };
                }
            } else return { err: new UnknownError(`unexpected url location${url && ` [${url?.toString()}](${url?.toString()})`} at login.`) };

            if (!location) return { err: new UnknownError("#MLSM62") };
            getTokenLocation = location;
        }
        {
            const res = await fetch(getTokenLocation, {
                method: "GET",
                headers: {
                    referer: "https://lng-tgk-aime-gw.am-all.net/",
                    cookie: Object.entries(loginCookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("; "),
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.startsWith("/maimai-mobile/home/")) {
                const cookie = this.getSetCookie(res);
                await this.cache.put(`cookielogin-${username}`, cookie, 15 * 60 * 1000);
                return { data: cookie };
            } else if (url?.pathname.startsWith("/maimai-mobile/error")) {
                return { err: await this.fetchErrorPageError(url, { ...loginCookies, ...this.getSetCookie(res) }) };
            } else
                return {
                    err: new UnknownError(`unexpected url location${url && ` [${url?.toString()}](${url?.toString()})`} at verifing token.`),
                };
        }
    }
}
