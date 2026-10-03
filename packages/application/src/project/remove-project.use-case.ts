import type { Clock, ProjectId } from "../import.js";
import type {
  ActivityLogger,
  CapabilityInvalidator,
  QueuePublisher,
  UnitOfWork,
} from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { QueueName } from "../primitive/index.js";
import type { ProjectRepository } from "./project.repository.js";
import { ProjectAccess } from "./project-access.js";

// Hidden at once, purged by a job: scans, graph files and comments can be many, and the
// request should not wait on them. The audit row stays with the tenant.
export class RemoveProjectUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly projects: ProjectRepository,
    private readonly capabilities: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly queue: QueuePublisher,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  public async execute(actor: Principal, input: { readonly projectId: ProjectId }): Promise<void> {
    const project = await ProjectAccess.load(
      this.authorizer,
      this.projects,
      actor,
      input.projectId,
      "project.delete",
    );

    await this.unitOfWork.run(async () => {
      await this.projects.markDeleted(actor.organizationId, project.id, this.clock.now());
      await this.activity.record(actor, "project.deleted", {
        projectId: project.id,
        name: project.name,
      });
    });

    await this.queue.publish(
      QueueName.MAINTENANCE,
      { organizationId: actor.organizationId, projectId: project.id },
      { name: "project-delete", jobId: `project-delete.${project.id}` },
    );
    await this.capabilities.invalidateOrganization(actor.organizationId);
  }
}
