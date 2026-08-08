import { PendingWorkPage } from './PendingWorkPage';

/** Task Manager is the canonical planning surface; /calendar remains a compatibility alias for old links. */
export function TaskManagerPage() {
  return <PendingWorkPage taskView />;
}
