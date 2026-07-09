import { BaseError } from "maidraw";
import { getCurrentMaintenanceEndTime, getCurrentMaintenanceStartTime } from "./maintenance";
import { getRelativeTime } from "./relativeTime";

export class BaseGcmError extends BaseError {
    constructor(type: string, message: string) {
        super("maidraw.adapter.gcm-net", type, message);
    }
}

export class AllNetMaintenanceError extends BaseGcmError {
    constructor() {
        super(
            "maintenance",
            `ALL.Net services are currently under scheduled maintenance. You cannot use ALL.Net services, including maimaiでらっくすNet, maimai DX NET, or オンゲキ-NET, during the maintenance. 
        
The maintenance period starts at 04:00 JST (${getRelativeTime(getCurrentMaintenanceStartTime())}) and ends at 07:00 JST (${getRelativeTime(getCurrentMaintenanceEndTime())}).`,
        );
    }
}

export class UnknownError extends BaseGcmError {
    constructor() {
        super("unknown", "An unknown error has occurred.");
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
