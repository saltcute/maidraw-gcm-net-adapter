import type { Database } from "gcm-database-otogedb/maimai";
import * as MaimaiDxNetEngScraper from "./lib/scraper/maimaidx-eng";
import { MaimaiDxNetAdapter } from "./maimaidx-net";

export class MaimaiDxNetEngAdapter extends MaimaiDxNetAdapter {
    protected scraper = MaimaiDxNetEngScraper;

    constructor({
        name = "maimaidx-net-eng-adapter",
        database,
    }: {
        name?: string;
        database: Database;
    }) {
        super({ name, database });
    }
}
