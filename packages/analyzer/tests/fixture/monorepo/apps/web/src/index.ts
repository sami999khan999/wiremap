import { VERSION } from "@acme/shared";
import { format } from "@acme/shared/format";
import { missing } from "./missing";
import lodash from "lodash";

export const label = `${VERSION} ${format(1)} ${missing} ${lodash}`;
