import type { ApiClient, RunScanInput, ScanDto } from "../import.js";
import { QueryKeys } from "../key/index.js";
import { useAppMutation } from "../runtime/index.js";

export class ScanMutations {
  private constructor() {}

  public static useRun(client: ApiClient) {
    return useAppMutation<ScanDto, RunScanInput>({
      mutationFn: (input) => client.scan.run(input),
      invalidates: [QueryKeys.scan.all()],
    });
  }
}
