import { BaseError } from "maidraw";

export class BaseGcmError extends BaseError {
    constructor(type: string, message: string) {
        super("maidraw.adapter.gcm-net", type, message);
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
