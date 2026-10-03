export const projectActions = {
  "project.created": { label: "Project created" },
  "project.updated": { label: "Project settings changed" },
  "project.deleted": { label: "Project deleted" },
  "project.repository.added": { label: "Repository connected" },
  "project.repository.updated": { label: "Repository settings changed" },
  "project.repository.removed": { label: "Repository disconnected" },
  "project.access.granted": { label: "Project access granted" },
  "project.access.revoked": { label: "Project access revoked" },
  "scan.requested": { label: "Scan started" },
  "scan.uploaded": { label: "Graph uploaded" },
  "github.installation.bound": { label: "GitHub connected" },
  "github.installation.removed": { label: "GitHub disconnected" },
} as const;
