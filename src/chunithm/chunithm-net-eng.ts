import { AllNetMaintenanceError } from "@common/error";
import type { Database } from "gcm-database-otogedb/chunithm";
import { ChunithmNetAdapter } from "./chunithm-net";
import { ChunithmNetEngScraper } from "./lib/scraper/chunithm-eng";

export class ChunithmNetEngAdapter extends ChunithmNetAdapter {
    protected scraper = new ChunithmNetEngScraper();
    protected readonly maintenanceStartHour: number = 4;
    protected readonly maintenanceEndHour: number = 7;
    protected get allNetMaintenanceError() {
        return new AllNetMaintenanceError(this.maintenanceStartHour, this.maintenanceEndHour, "default");
    }

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
