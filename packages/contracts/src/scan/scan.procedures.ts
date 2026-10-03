import { oc } from "../import.js";
import { Envelope } from "../primitive/index.js";
import { ScanContract } from "./scan.contract.js";

export class ScanProcedures {
  private constructor() {}

  public static readonly list = oc
    .route({ method: "GET", path: "/projects/{projectId}/scans" })
    .input(ScanContract.listQuery)
    .output(Envelope.paginated(ScanContract.entity));

  // Answers with the scan already queued or running when there is one, rather than a second.
  public static readonly run = oc
    .route({ method: "POST", path: "/projects/{projectId}/scans" })
    .input(ScanContract.run)
    .output(ScanContract.entity);

  public static readonly createUpload = oc
    .route({ method: "POST", path: "/scans/upload" })
    .input(ScanContract.createUpload)
    .output(ScanContract.upload);

  public static readonly graph = oc
    .route({ method: "GET", path: "/projects/{projectId}/graph" })
    .input(ScanContract.graphQuery)
    .output(ScanContract.graph);

  public static readonly all = {
    list: ScanProcedures.list,
    run: ScanProcedures.run,
    createUpload: ScanProcedures.createUpload,
    graph: ScanProcedures.graph,
  } as const;
}
