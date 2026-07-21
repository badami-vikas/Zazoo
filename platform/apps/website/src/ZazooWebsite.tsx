import { DifferenceScene, ImpactScene, ProcessScene, ValuesScene } from "./scenes-chapters";
import { MorningScene, NightScene } from "./scenes-closing";
import { FamilyScene, GovernanceScene, HeroScene, LibraryScene } from "./scenes-opening";

export function ZazooWebsite() {
  return (
    <main className="zazoo-website">
      <HeroScene />
      <FamilyScene />
      <GovernanceScene />
      <LibraryScene />
      <ValuesScene />
      <ProcessScene />
      <DifferenceScene />
      <ImpactScene />
      <NightScene />
      <MorningScene />
    </main>
  );
}
