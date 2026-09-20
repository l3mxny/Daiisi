// The Daiisi mark: a wheat sprig whose two middle leaves are cupped hands. Drawn as outline in the current text
// colour, so it takes whatever colour its parent sets (lime on the olive sidebar).
export default function Logo({ className = "h-20 w-auto" }: { className?: string }) {
  // Right half is the left half mirrored around the stem (x = 550): x -> 1100 - x.
  const half = (
    <>
      {/* upper leaf */}
      <path d="M541 522C425 505 362 405 372 305C373 291 386 284 400 292C478 330 536 410 542 522Z" />
      {/* hand */}
      <path d="M541 768C395 788 272 695 271 492C270 452 296 436 316 452C334 467 346 520 351 580" />
      <path d="M351 580C345 528 337 492 322 474M372 508C392 530 408 570 414 600" />
      <path d="M318 594C312 650 375 690 430 690M320 592C395 598 505 650 541 740" />
      {/* lower leaf */}
      <path d="M525 1096C395 1092 244 1010 249 806C250 748 262 732 278 732C398 770 510 900 527 1092Z" />
    </>
  );
  return (
    <svg
      viewBox="230 70 640 1180"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="22"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* bud and stem */}
      <circle cx="550" cy="112" r="22" fill="currentColor" />
      <path d="M550 130V1224" />
      {/* top leaf */}
      <path d="M550 178C500 218 500 322 550 362C600 322 600 218 550 178Z" />
      {half}
      <g transform="translate(1100 0) scale(-1 1)">{half}</g>
    </svg>
  );
}
