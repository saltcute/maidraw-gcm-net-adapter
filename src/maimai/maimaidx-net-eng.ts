import type { Database } from "gcm-database-otogedb/maimai";
import { MaimaiDxNetEngScraper } from "./lib/scraper/maimaidx-eng";
import { MaimaiDxNetAdapter } from "./maimaidx-net";

export class MaimaiDxNetEngAdapter extends MaimaiDxNetAdapter {
    protected scraper = new MaimaiDxNetEngScraper();

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
