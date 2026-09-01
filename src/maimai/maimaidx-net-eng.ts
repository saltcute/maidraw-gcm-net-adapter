import { AllNetMaintenanceError } from "@common/error";
import { currentJstDayOfWeek } from "@common/maintenance";
import type { Database } from "gcm-database-otogedb/maimai";
import { MaimaiDxNetEngScraper } from "./lib/scraper/maimaidx-eng";
import { MaimaiDxNetAdapter } from "./maimaidx-net";

export class MaimaiDxNetEngAdapter extends MaimaiDxNetAdapter {
    protected scraper = new MaimaiDxNetEngScraper();
    protected get maintenanceStartHour() {
        return 1;
    }
    protected get maintenanceEndHour() {
        if (currentJstDayOfWeek() === "Wednesday") return 4;
        return 2;
    }
    protected get allNetMaintenanceError() {
        return new AllNetMaintenanceError(this.maintenanceStartHour, this.maintenanceEndHour, "maimaidx-eng");
    }

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
