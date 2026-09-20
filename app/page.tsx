import FarmOSApp from "@/components/FarmOSApp";
import LanguageProvider from "@/components/LanguageProvider";

export default function Home() {
  return (
    <LanguageProvider>
      <FarmOSApp />
    </LanguageProvider>
  );
}
