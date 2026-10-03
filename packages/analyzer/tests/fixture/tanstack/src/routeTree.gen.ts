import { Route as rootRoute } from "./routes/__root";
import { Route as indexRoute } from "./routes/index";
import { Route as postRoute } from "./routes/posts/$postId";
import { Route as usersRoute } from "./routes/api/users";

export const routeTree = rootRoute.addChildren([indexRoute, postRoute, usersRoute]);
