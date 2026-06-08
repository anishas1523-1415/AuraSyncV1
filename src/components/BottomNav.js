"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, MagnifyingGlass, Sparkle, Books } from "@phosphor-icons/react";
import styles from "./BottomNav.module.css";

export default function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    { name: "Home", href: "/", icon: House },
    { name: "Search", href: "/search", icon: MagnifyingGlass },
    { name: "Discover", href: "/discover", icon: Sparkle },
    { name: "Library", href: "/library", icon: Books },
  ];

  return (
    <nav className={`glass ${styles.bottomNav}`}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link 
            href={item.href} 
            key={item.name} 
            className={`${styles.navItem} ${isActive ? styles.active : ""}`}
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.vibrate) {
                navigator.vibrate(10);
              }
            }}
          >
            <Icon size={28} weight={isActive ? "fill" : "regular"} />
            <span className={styles.navLabel}>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
