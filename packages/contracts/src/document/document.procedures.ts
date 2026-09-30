import { oc, z } from "../import.js";
import { DocumentContract } from "./document.contract.js";

export class DocumentProcedures {
  private constructor() {}

  // `POST` and a queued response: the work happens in the worker, and a request that
  // waited for it would hold a connection open for a provider round trip.
  public static readonly index = oc
    .route({ method: "POST", path: "/documents" })
    .input(DocumentContract.index)
    .output(DocumentContract.queued);

  // `POST` rather than `GET` despite being a read: the query is the body, and a search
  // string in a URL is a search string in every access log between here and the server.
  public static readonly search = oc
    .route({ method: "POST", path: "/documents/search" })
    .input(DocumentContract.search)
    .output(z.object({ hits: z.array(DocumentContract.hit).readonly() }));

  // The object the merge point in `procedure/index.ts` mounts. One place to add a
  // procedure to, rather than two.
  public static readonly all = {
    index: DocumentProcedures.index,
    search: DocumentProcedures.search,
  } as const;
}
