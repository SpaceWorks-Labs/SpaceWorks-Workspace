import "./landing.css";
import { HeroSequence } from "@/components/landing/HeroSequence";
import { HeroPreview } from "@/components/landing/HeroPreview";
import { InstallSection } from "@/components/landing/InstallSection";
import { HeroCopy, OrganisationsSection, ReleaseBand, StoryContent } from "@/components/landing/LandingIntro";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { AreasSection, ScreensSection } from "@/components/landing/ProductSections";
import { DocsSection, FaqSection, FoundationsSection } from "@/components/landing/ReferenceSections";
import { RevealOnScroll } from "@/components/landing/RevealOnScroll";

/**
 * The public landing page for signed-out visitors at `/`. Pure rendering: the
 * page passes the instance's self sign-up switch in, nothing here reads data.
 * Section order follows the Space Works Labs website: hero scene, ink band,
 * story, teal installer, catalogue, dark screens band, docs, foundations, FAQ
 * and the citron colophon.
 */
export function LandingPage({ allowSignup }: { allowSignup: boolean }) {
  return (
    <div className="landing flex min-h-dvh flex-col bg-canvas text-ink">
      <LandingHeader allowSignup={allowSignup} />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <HeroSequence copy={<HeroCopy allowSignup={allowSignup} />} preview={<HeroPreview />} story={<StoryContent />} />
        <ReleaseBand />
        <OrganisationsSection />
        <InstallSection />
        <AreasSection />
        <ScreensSection />
        <DocsSection />
        <FoundationsSection />
        <FaqSection allowSignup={allowSignup} />
      </main>
      <LandingFooter allowSignup={allowSignup} />
      <RevealOnScroll />
    </div>
  );
}
