import { UnknownError } from "@common/error";
import { Cache } from "@saltcute/cache";
import type { DataOrError } from "maidraw";
import { type Cookie, MaimaiDxNetScraper } from "./maimaidx";

export class MaimaiDxNetEngScraper extends MaimaiDxNetScraper {
    protected readonly origin = "https://maimaidx-eng.com/";
    protected readonly newScoreVersion = 25500;

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
            if (!(res.status >= 200 && res.status < 300)) return { err: new UnknownError() };

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
            if (url?.pathname.startsWith("/maimai-mobile")) {
                loginCookies = {
                    ...loginCookies,
                    ...this.getSetCookie(res),
                };
            } else if (url?.pathname.startsWith("/maimai-mobile/error")) {
                const errorPageRes = await this.fetch(url);
                if (!errorPageRes.ok) return { err: new UnknownError() };
                const errorPage = await errorPageRes.text();
                return { err: this.getErrorPageError(errorPage) };
            } else return { err: new UnknownError() };

            if (!location) return { err: new UnknownError() };
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
                const errorPageRes = await this.fetch(url);
                if (!errorPageRes.ok) return { err: new UnknownError() };
                const errorPage = await errorPageRes.text();
                return { err: this.getErrorPageError(errorPage) };
            } else return { err: new UnknownError() };
        }
    }
}
