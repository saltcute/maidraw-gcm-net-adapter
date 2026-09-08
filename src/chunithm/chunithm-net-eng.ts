import { ALL_NET_MAINTENANCE, type MaintenanceSchedule } from "@common/maintenance";
import type { Database } from "gcm-database-otogedb/chunithm";
import { ChunithmNetAdapter } from "./chunithm-net";
import { ChunithmNetEngScraper } from "./lib/scraper/chunithm-eng";

export class ChunithmNetEngAdapter extends ChunithmNetAdapter {
    protected scraper = new ChunithmNetEngScraper();

    public readonly maintenanceSchedule: MaintenanceSchedule = ALL_NET_MAINTENANCE;
    protected readonly maintenanceService: "default" | "maimaidx-eng" | "chunithm" = "default";

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
