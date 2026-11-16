export interface Module15Browser {
  origins: {admin:string;store:string};
  outputRoot:string;
  reporting(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  refundFailure(input:Record<string,unknown>):Promise<{failedBody:Record<string,unknown>;failedResult:Record<string,unknown>;retryBody:Record<string,unknown>;retryResult:Record<string,unknown>}>;
  order(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  settlement(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  finalize(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  setPermissions(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  fulfillment(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  revokedForm(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  states(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  conflict(input:Record<string,unknown>):Promise<Record<string,unknown>>;
  close():Promise<void>;
}
export function createModule15Browser(options:{apiBaseUrl:string;env?:NodeJS.ProcessEnv;outputRoot?:string}):Promise<Module15Browser>;
