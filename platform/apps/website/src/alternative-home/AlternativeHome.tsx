import { InfrastructureScene } from "./section-infrastructure";
import { JourneyScene } from "./section-journey";
import { OrganizationScene } from "./section-organization";
import { ShiftsScene } from "./section-shifts";

export function AlternativeHome() {
  return (
    <main className="alternative-home">
      <ShiftsScene />
      <OrganizationScene />
      <InfrastructureScene />
      <JourneyScene />
    </main>
  );
}
