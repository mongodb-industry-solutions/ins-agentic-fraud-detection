import { Lexend_Deca, Source_Code_Pro, Source_Serif_4 } from "next/font/google";

import "./globals.css";
import { Providers } from "./providers";

/* Three families, three non-overlapping jobs:
   serif   -> page headline + brand name, nothing else
   sans    -> all UI text (300 Light default, 400 Normal for emphasis)
   mono    -> every numeric/identifier value, always rendered uppercase */
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-source-serif",
});

const lexendDeca = Lexend_Deca({
  subsets: ["latin"],
  weight: ["300", "400"],
  display: "swap",
  variable: "--font-lexend-deca",
});

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-source-code-pro",
});

export const metadata = {
  title: "Leafy Claim Manager",
  description: "Claims management & Agentic fraud detection",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${lexendDeca.variable} ${sourceCodePro.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
