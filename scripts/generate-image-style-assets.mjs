#!/usr/bin/env node
/**
 * Phase 17 系统配图风格参考图生成器。
 *
 * SVG 是可维护源文件，PNG 是运行时给图片模型使用的 reference。脚本不参与 build；
 * 只在新增/调整系统风格时手动运行。macOS 用 sips 做无损 SVG→PNG 栅格化。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('packages/slidev/image-styles')
const WIDTH = 1280
const HEIGHT = 624

function shell(body, { background = '#f7f5f0', defs = '' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>${defs}</defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${background}"/>
  ${body}
</svg>\n`
}

function flatInfographic() {
  return shell(`
    <circle cx="170" cy="126" r="84" fill="#f5d85e"/>
    <rect x="92" y="256" width="248" height="238" rx="30" fill="#16324f"/>
    <rect x="382" y="90" width="360" height="404" rx="34" fill="#ffffff" stroke="#16324f" stroke-width="8"/>
    <rect x="430" y="150" width="160" height="28" rx="14" fill="#e65a4f"/>
    <rect x="430" y="202" width="254" height="16" rx="8" fill="#b9c7d3"/>
    <rect x="430" y="236" width="218" height="16" rx="8" fill="#d7dfe5"/>
    <path d="M454 420V330M522 420V286M590 420V354M658 420V250" stroke="#2a9d8f" stroke-width="34" stroke-linecap="round"/>
    <circle cx="930" cy="310" r="170" fill="#dbeee8"/>
    <path d="M838 336l72-82 72 52 92-112" fill="none" stroke="#16324f" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="838" cy="336" r="20" fill="#e65a4f"/><circle cx="910" cy="254" r="20" fill="#f5d85e"/><circle cx="982" cy="306" r="20" fill="#2a9d8f"/><circle cx="1074" cy="194" r="20" fill="#e65a4f"/>
  `)
}

function editorialIllustration() {
  return shell(`
    <path d="M0 500C220 420 332 516 520 454s322-192 760-84v254H0z" fill="#eed9c4"/>
    <circle cx="280" cy="205" r="112" fill="#f2b8a2"/>
    <path d="M225 230c0-110 40-155 110-142 58 11 84 64 72 128-42-36-81-55-182 14z" fill="#27364b"/>
    <path d="M170 480c18-142 72-220 150-220s136 78 160 220z" fill="#315e7d"/>
    <path d="M278 312c100 42 158 76 220 128" fill="none" stroke="#f2b8a2" stroke-width="42" stroke-linecap="round"/>
    <rect x="486" y="228" width="350" height="226" rx="20" fill="#fffdf8" stroke="#27364b" stroke-width="7" transform="rotate(-3 661 341)"/>
    <circle cx="620" cy="322" r="62" fill="#f0c84b"/><path d="M620 322l105-58" stroke="#df6d52" stroke-width="24" stroke-linecap="round"/><path d="M620 322l56 86" stroke="#65a58c" stroke-width="24" stroke-linecap="round"/>
    <path d="M915 490c-34-168-16-278 58-330 44 80 39 145-12 198 55-51 110-62 167-32-38 102-104 155-213 164z" fill="#6a9b7d"/>
    <rect x="892" y="468" width="176" height="44" rx="18" fill="#27364b"/>
  `)
}

function technicalBlueprint() {
  const grid =
    Array.from({ length: 17 }, (_, i) => `<path d="M${i * 80} 0v624"/>`).join('') +
    Array.from({ length: 9 }, (_, i) => `<path d="M0 ${i * 80}h1280"/>`).join('')
  return shell(
    `
    <g stroke="#1d5a79" stroke-width="1" opacity=".55">${grid}</g>
    <g fill="none" stroke="#7fe3ff" stroke-width="5">
      <rect x="116" y="132" width="276" height="176" rx="16"/><rect x="492" y="88" width="298" height="126" rx="16"/><rect x="488" y="330" width="306" height="180" rx="16"/><circle cx="1030" cy="302" r="146"/>
      <path d="M392 220h100M638 214v116M794 420h90c0-65 48-118 106-118"/>
      <path d="M166 180h176M166 222h110M166 264h144M540 138h202M540 174h126" stroke-width="3"/>
      <path d="M550 438l60-62 58 52 72-78"/><path d="M952 302h156M1030 224v156"/>
    </g>
    <g fill="#7fe3ff"><circle cx="492" cy="220" r="10"/><circle cx="638" cy="330" r="10"/><circle cx="884" cy="420" r="10"/></g>
    <g fill="#ffb84d"><circle cx="116" cy="132" r="9"/><circle cx="790" cy="88" r="9"/><circle cx="794" cy="510" r="9"/><circle cx="1030" cy="302" r="11"/></g>
  `,
    { background: '#082a40' },
  )
}

function isometric3d() {
  return shell(
    `
    <ellipse cx="640" cy="520" rx="438" ry="58" fill="#dce3ec"/>
    <path d="M318 330l218-126 218 126-218 126z" fill="#9fd5e8"/>
    <path d="M318 330v124l218 126V456z" fill="#5a9fbd"/>
    <path d="M754 330v124L536 580V456z" fill="#36758f"/>
    <path d="M534 156l140-80 140 80-140 82z" fill="#f3cb58"/>
    <path d="M534 156v156l140 82V238z" fill="#dd8f43"/>
    <path d="M814 156v156l-140 82V238z" fill="#bd633f"/>
    <path d="M806 344l112-64 112 64-112 66z" fill="#a6dfc8"/>
    <path d="M806 344v104l112 66V410z" fill="#52a987"/>
    <path d="M1030 344v104l-112 66V410z" fill="#2e7b62"/>
    <path d="M226 242l82-48 82 48-82 48z" fill="#e9b8cf"/><path d="M226 242v96l82 48v-96z" fill="#c77fa3"/><path d="M390 242v96l-82 48v-96z" fill="#965a7c"/>
    <path d="M404 250c42-68 82-100 130-110M814 244c60 6 96 34 116 82" fill="none" stroke="#27364b" stroke-width="10" stroke-linecap="round" stroke-dasharray="16 18"/>
  `,
    { background: '#f4f7fb' },
  )
}

function clay3d() {
  const defs = `
    <linearGradient id="clayA" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffad8f"/><stop offset="1" stop-color="#d95f78"/></linearGradient>
    <linearGradient id="clayB" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#93dbd2"/><stop offset="1" stop-color="#3c91a8"/></linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#705f73" flood-opacity=".28"/></filter>`
  return shell(
    `
    <ellipse cx="640" cy="512" rx="470" ry="62" fill="#d9d0dc" opacity=".7"/>
    <g filter="url(#shadow)">
      <rect x="190" y="200" width="250" height="252" rx="92" fill="url(#clayA)" transform="rotate(-9 315 326)"/>
      <circle cx="604" cy="268" r="162" fill="url(#clayB)"/>
      <path d="M824 170c122-54 254 18 272 142 18 126-84 228-216 207-102-16-154-112-128-204 14-52 28-110 72-145z" fill="#efcf5b"/>
      <rect x="498" y="220" width="214" height="96" rx="48" fill="#fff6ed" transform="rotate(22 605 268)"/>
      <circle cx="914" cy="326" r="64" fill="#f6a7c4"/>
    </g>
    <g fill="#fff" opacity=".48"><ellipse cx="267" cy="244" rx="52" ry="28" transform="rotate(-22 267 244)"/><ellipse cx="552" cy="188" rx="62" ry="32" transform="rotate(-25 552 188)"/><ellipse cx="862" cy="207" rx="70" ry="28" transform="rotate(-18 862 207)"/></g>
  `,
    { background: '#f1edf4', defs },
  )
}

function paperCut() {
  const defs = `<filter id="paperShadow"><feDropShadow dx="0" dy="12" stdDeviation="9" flood-color="#4d3d39" flood-opacity=".22"/></filter>`
  return shell(
    `
    <g filter="url(#paperShadow)">
      <path d="M0 486c158-142 286-165 430-68 158 107 296 88 420-55 118-137 252-156 430-58v319H0z" fill="#315b6d"/>
      <path d="M0 522c174-92 338-89 492 10 140 90 308 61 456-58 98-78 206-84 332-22v172H0z" fill="#5e9b83"/>
      <path d="M0 560c206-68 386-40 540 58h740v6H0z" fill="#e3b852"/>
      <circle cx="930" cy="212" r="118" fill="#f3cb69"/>
      <path d="M150 394l206-268 188 268z" fill="#d56d5d"/>
      <path d="M356 394L596 90l238 304z" fill="#dcaea4"/>
      <path d="M596 394l132-168 130 168z" fill="#f2e1cf"/>
    </g>
    <g fill="#f8f1e7"><path d="M985 105c44 10 72 34 84 72-38-22-72-22-104 0 8-33 15-56 20-72z"/><path d="M1080 162c38 8 64 28 76 58-34-18-64-16-92 4 5-26 10-47 16-62z"/></g>
  `,
    { background: '#f6eadc', defs },
  )
}

function softWatercolor() {
  const defs = `
    <filter id="wash"><feTurbulence type="fractalNoise" baseFrequency=".015" numOctaves="3" seed="8" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="34"/><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="3"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .08 0"/></filter>`
  return shell(
    `
    <g filter="url(#wash)" opacity=".72">
      <ellipse cx="332" cy="300" rx="236" ry="174" fill="#e99b91"/>
      <ellipse cx="624" cy="246" rx="246" ry="176" fill="#efcb77"/>
      <ellipse cx="852" cy="332" rx="264" ry="190" fill="#6eb6ac"/>
      <ellipse cx="1050" cy="220" rx="142" ry="126" fill="#719ac0"/>
    </g>
    <path d="M155 414c148-154 268-94 378-168 128-86 202 38 304 0 116-44 181-11 286 104" fill="none" stroke="#375d68" stroke-width="10" stroke-linecap="round" opacity=".62"/>
    <g fill="#375d68" opacity=".7"><circle cx="155" cy="414" r="13"/><circle cx="533" cy="246" r="13"/><circle cx="837" cy="246" r="13"/><circle cx="1123" cy="350" r="13"/></g>
    <rect width="1280" height="624" filter="url(#grain)" opacity=".5"/>
  `,
    { background: '#fbf8f0', defs },
  )
}

function coloredPencil() {
  const strokes = Array.from({ length: 11 }, (_, i) => {
    const y = 112 + i * 38
    const wobble = i % 2 ? 12 : -10
    const colors = ['#d76d5f', '#315e7d', '#d7a642', '#5b9279']
    return `<path d="M120 ${y} C300 ${y + wobble}, 420 ${y - wobble}, 590 ${y} S880 ${y + wobble}, 1160 ${y - 4}" stroke="${colors[i % colors.length]}"/>`
  }).join('')
  return shell(
    `
    <g fill="none" stroke-width="8" stroke-linecap="round" opacity=".3">${strokes}</g>
    <g fill="none" stroke="#29394c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M182 418c60-190 150-274 270-250 86 18 138 88 156 212"/>
      <path d="M234 376l120-92 108 72 116-134"/>
      <circle cx="354" cy="284" r="26"/><circle cx="462" cy="356" r="26"/>
      <path d="M698 176c110-70 238-34 294 62 56 97 28 205-62 258-100 59-224 21-274-76-46-88-16-190 42-244z"/>
      <path d="M754 354l82-112 96 138"/><path d="M834 242v210"/>
    </g>
    <g fill="none" stroke-width="20" stroke-linecap="round" opacity=".7"><path d="M232 438l136-104" stroke="#d76d5f"/><path d="M396 408l146-168" stroke="#d7a642"/><path d="M738 434l98-192" stroke="#5b9279"/><path d="M836 242l104 176" stroke="#638aaa"/></g>
  `,
    { background: '#fbf3df' },
  )
}

function inkWash() {
  const defs = `<filter id="ink"><feTurbulence type="fractalNoise" baseFrequency=".02" numOctaves="4" seed="12" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="28"/><feGaussianBlur stdDeviation="3"/></filter>`
  return shell(
    `
    <g filter="url(#ink)">
      <path d="M74 486c142-24 196-238 330-266 102-22 142 120 236 82 116-46 174-216 306-190 105 20 120 173 254 226v166H74z" fill="#273139" opacity=".84"/>
      <path d="M116 488c154-42 218-172 326-178 100-6 152 92 240 48 86-42 136-142 242-136 112 6 154 106 234 142" fill="none" stroke="#6c7778" stroke-width="46" opacity=".5"/>
      <circle cx="927" cy="174" r="92" fill="#c8c5b9" opacity=".74"/>
    </g>
    <g fill="none" stroke="#20282d" stroke-width="7" stroke-linecap="round"><path d="M224 424c72-132 132-212 180-244"/><path d="M362 240c-50-38-86-44-118-18M386 210c34-62 72-90 114-100M350 280c72 2 118 22 142 60"/></g>
    <rect x="1080" y="430" width="66" height="66" rx="6" fill="#b93c33" opacity=".9"/>
  `,
    { background: '#f5f2e9', defs },
  )
}

function bauhaus() {
  return shell(
    `
    <rect x="92" y="78" width="250" height="468" fill="#202a3a"/>
    <circle cx="342" cy="196" r="118" fill="#e55245"/>
    <path d="M342 78h238v236H342z" fill="#f1c84b"/>
    <circle cx="580" cy="314" r="118" fill="#326e99"/>
    <rect x="580" y="78" width="148" height="118" fill="#f5f1e8"/>
    <path d="M728 78h198v468H728z" fill="#e55245"/>
    <circle cx="827" cy="222" r="68" fill="#202a3a"/>
    <path d="M926 78h262v234L1057 78z" fill="#326e99"/>
    <path d="M926 312h262v234H926z" fill="#f1c84b"/>
    <circle cx="1057" cy="429" r="78" fill="#f5f1e8"/>
    <path d="M342 314h238v232H342z" fill="#f5f1e8"/><path d="M390 498l70-136 72 136z" fill="#202a3a"/>
  `,
    { background: '#e9e2d4' },
  )
}

function editorialCollage() {
  const defs = `<pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="3" fill="#172d3d"/></pattern><filter id="rough"><feTurbulence baseFrequency=".04" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="9"/></filter>`
  return shell(
    `
    <rect x="82" y="88" width="420" height="448" fill="#e8c35e" transform="rotate(-4 292 312)" filter="url(#rough)"/>
    <rect x="304" y="52" width="492" height="350" fill="#e9e5db" transform="rotate(5 550 227)"/>
    <path d="M332 344c26-164 116-246 258-222 112 20 170 104 158 236-134-86-272-90-416-14z" fill="#3b7186"/>
    <circle cx="530" cy="234" r="86" fill="#e07a67"/>
    <rect x="706" y="152" width="426" height="332" fill="url(#dots)" transform="rotate(-3 919 318)" opacity=".72"/>
    <path d="M682 490l212-308 238 308z" fill="#f4eee4" filter="url(#rough)"/>
    <path d="M816 448l96-154 92 154z" fill="#172d3d"/>
    <rect x="146" y="430" width="548" height="58" fill="#172d3d" transform="rotate(2 420 459)"/>
    <circle cx="1112" cy="120" r="62" fill="#e07a67"/>
  `,
    { background: '#d9d4c8', defs },
  )
}

function minimalLineArt() {
  return shell(
    `
    <g fill="none" stroke="#1d3448" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="292" cy="304" r="150"/>
      <path d="M186 304h212M292 198v212M214 226l156 156M370 226L214 382" opacity=".5"/>
      <rect x="494" y="154" width="286" height="300" rx="44"/>
      <path d="M548 368l62-84 58 58 64-112"/><circle cx="610" cy="284" r="12" fill="#1d3448"/>
      <path d="M884 454c-16-168 12-276 84-324 72 48 100 156 84 324z"/>
      <path d="M968 130v324M906 260l62 42 70-70M904 358l64 40 78-62"/>
    </g>
    <g fill="#d35e52"><circle cx="292" cy="304" r="24"/><circle cx="732" cy="230" r="18"/><circle cx="968" cy="130" r="18"/></g>
    <path d="M86 520h1108" stroke="#cfcbc1" stroke-width="5" stroke-linecap="round"/>
  `,
    { background: '#faf8f2' },
  )
}

const renderers = new Map([
  ['flat-infographic', flatInfographic],
  ['editorial-illustration', editorialIllustration],
  ['technical-blueprint', technicalBlueprint],
  ['isometric-3d', isometric3d],
  ['clay-3d', clay3d],
  ['paper-cut', paperCut],
  ['soft-watercolor', softWatercolor],
  ['colored-pencil', coloredPencil],
  ['ink-wash', inkWash],
  ['bauhaus-geometric', bauhaus],
  ['editorial-collage', editorialCollage],
  ['minimal-line-art', minimalLineArt],
])

for (const [id, render] of renderers) {
  const dir = path.join(ROOT, id)
  mkdirSync(dir, { recursive: true })
  const svgPath = path.join(dir, 'reference.svg')
  const pngPath = path.join(dir, 'reference.png')
  writeFileSync(svgPath, render(), 'utf8')
  execFileSync('/usr/bin/sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], {
    stdio: 'ignore',
  })
}

console.log(`generated ${renderers.size} image style references in ${ROOT}`)
