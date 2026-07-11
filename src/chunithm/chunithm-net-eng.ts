import type { Database } from "gcm-database-otogedb/chunithm";
import { ChunithmNetAdapter } from "./chunithm-net";
import { ChunithmNetEngScraper } from "./lib/scraper/chunithm-eng";

export class ChunithmNetEngAdapter extends ChunithmNetAdapter {
    protected scraper = new ChunithmNetEngScraper();

    constructor({
        name = "chunithm-net-eng-adapter",
        database,
    }: {
        name?: string;
        database: Database;
    }) {
        super({ name, database });
    }
}
