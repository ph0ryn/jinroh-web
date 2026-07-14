import Image from "next/image";
import Link from "next/link";

import styles from "./jinrohBrandLink.module.css";

type JinrohBrandLinkProps = {
  readonly className?: string;
};

export function JinrohBrandLink({ className }: JinrohBrandLinkProps) {
  const brandClassName =
    className === undefined ? styles["brand"] : `${styles["brand"]} ${className}`;

  return (
    <Link className={brandClassName} href="/" aria-label="Jinroh Web home">
      <span className={styles["mark"]}>
        <Image alt="" aria-hidden="true" height={32} src="/images/jinroh-mark.png" width={32} />
      </span>
      <span className={styles["name"]}>
        <strong>Jinroh</strong>
        <span>WEB</span>
      </span>
    </Link>
  );
}
