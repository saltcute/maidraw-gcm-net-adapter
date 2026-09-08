import { BaseError } from "maidraw";
import { ALL_NET_MAINTENANCE, type MaintenanceWindow } from "./maintenance";
import { getRelativeTime } from "./relativeTime";

const jstTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

export class BaseGcmError extends BaseError {
    constructor(type: string, message: string) {
        super("maidraw.adapter.gcm-net", type, message);
    }
}

export class AllNetMaintenanceError extends BaseGcmError {
    private static readonly servicesMap = {
        default: "maimaiでらっくすNET, CHUNITHM-NET, or オンゲキ-NET",
        "maimaidx-eng": "maimai DX NET",
        chunithm: "CHUNITHM-NET",
    };
    private readonly startTimestamp: number;
    private readonly endTimestamp: number;

    constructor(
        window: MaintenanceWindow = ALL_NET_MAINTENANCE.getCurrentOrNextWindow(),
        private service: "default" | "maimaidx-eng" | "chunithm" = "default",
    ) {
        super(
            "maintenance",
            `The ALL.Net service is currently under scheduled maintenance. You cannot use ALL.Net services, including ${AllNetMaintenanceError.servicesMap[service]}, during the maintenance.

The maintenance period started at ${jstTimeFormatter.format(window.start)} JST (${getRelativeTime(window.start)}) and will end at ${jstTimeFormatter.format(window.end)} JST (${getRelativeTime(window.end)}).`,
        );
        this.startTimestamp = Math.floor(window.start.getTime() / 1000);
        this.endTimestamp = Math.floor(window.end.getTime() / 1000);
    }
    public getDiscordMarkdownContent() {
        const startTimestamp = this.startTimestamp;
        const endTimestamp = this.endTimestamp;
        return `The ALL.Net service is currently under scheduled maintenance. You cannot use ALL.Net services, including ${AllNetMaintenanceError.servicesMap[this.service]}, during the maintenance. 

The maintenance period started at <t:${startTimestamp}:t> (<t:${startTimestamp}:R>), and will end at <t:${endTimestamp}:t> (<t:${endTimestamp}:R>).`;
    }
}

export class UnknownError extends BaseGcmError {
    constructor(detail?: string) {
        super("unknown", `An unknown error has occurred.${detail && ` More info: ${detail}`}`);
    }
}

export class FailedToDecryptError extends BaseGcmError {
    constructor() {
        super("failed-to-decrypt", "Decryption failed");
    }
}

export class FailedToAuthenticateError extends BaseGcmError {
    constructor() {
        super("failed-to-authenticate", "Failed to authenticate using provided credentials");
    }
}
