import { UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import type { DataOrError } from "maidraw";
import { fetch } from "undici";
import { ChunithmNetScraper, type Cookie } from "./chunithm";

export class ChunithmNetEngScraper extends ChunithmNetScraper {
    protected readonly origin = "https://chunithm-net-eng.com/";
    protected readonly mobile = "mobile";
    protected readonly newScoreVersion = 245;

    protected cache = new Cache("maidraw/adapter/chunithm-net-eng-scraper");
    public async login(username: string, password: string): Promise<DataOrError<Cookie>> {
        const cached = await this.cache.get(`cookielogin-${username}`);
        if (cached) {
            if (await this.checkLogin(cached)) {
                return { data: cached };
            }
        }
        // Establish a game-domain session first; the SSID callback below binds to
        // it, otherwise the callback errors with "please login again" (100001).
        let cookies = this.getSetCookie(await this.fetch(this.url("")));

        const loginUrl =
            "https://lng-tgk-aime-gw.am-all.net/common_auth/login?site_id=chuniex&redirect_url=https://chunithm-net-eng.com/mobile/&back_url=https://chunithm.sega.com/";
        let gatewayCookies: Record<string, string> = {};
        {
            const res = await this.fetch(loginUrl, {
                headers: {
                    referer: undefined,
                },
            });
            if (!(res.status >= 200 && res.status < 300)) return { err: new UnknownError() };

            gatewayCookies = this.getSetCookie(res);
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
                    referer: loginUrl,
                    cookie: this.cookieHeader(gatewayCookies),
                },
                redirect: "manual",
            });

            const location = res.headers.get("location");
            const url = location ? new URL(location) : null;
            if (url?.pathname.includes("/error")) {
                return { err: await this.fetchErrorPageError(url, cookies) };
            } else if (url?.pathname.startsWith("/mobile")) {
                gatewayCookies = {
                    ...gatewayCookies,
                    ...this.getSetCookie(res),
                };
            } else return { err: new UnknownError() };

            if (!location) return { err: new UnknownError() };
            getTokenLocation = location;
        }
        {
            const res = await this.fetch(getTokenLocation, {
                headers: {
                    referer: "https://lng-tgk-aime-gw.am-all.net/",
                    cookie: this.cookieHeader(cookies),
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
                await this.cache.put(`cookielogin-${username}`, cookies, 15 * 60 * 1000);
                return { data: cookies };
            } else if (url?.pathname.includes("/error")) {
                return { err: await this.fetchErrorPageError(url, { ...cookies, ...this.getSetCookie(res) }) };
            } else return { err: new UnknownError() };
        }
    }
}
