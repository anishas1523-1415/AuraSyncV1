"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkle, MagnifyingGlass, PlayCircle, Planet, User } from "@phosphor-icons/react/dist/ssr";
import styles from "./AuraDial.module.css";
import { useState } from "react";

export default function AuraDial() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { name: "Home", href: "/", icon: Planet },
    { name: "Search", href: "/search", icon: MagnifyingGlass },
    { name: "Discover", href: "/discover", icon: Sparkle },
    { name: "Now Playing", href: "/player", icon: PlayCircle },
    { name: "Profile", href: "/profile", icon: User },
  ];


  return (
    <div className={styles.dialContainer}>
      <div className={`${styles.menu} ${isOpen ? styles.open : ''}`}>
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link 
              href={item.href} 
              key={item.name} 
              className={`${styles.navItem} ${isActive ? styles.active : ""}`}
              onClick={() => setIsOpen(false)}
            >
              <Icon size={24} weight={isActive ? "fill" : "regular"} />
            </Link>
          );
        })}
      </div>
      <button 
        className={`${styles.mainBtn} ${isOpen ? styles.btnOpen : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={styles.btnCore}></span>
      </button>
    </div>
  );
}
