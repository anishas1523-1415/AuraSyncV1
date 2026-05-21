"use client";
import styles from './TopBar.module.css';
import { UserButton, useUser } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { Bell, Users, Waves } from '@phosphor-icons/react';
import Link from 'next/link';

export default function TopBar() {
  const { user, isLoaded } = useUser();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  const displayName = isLoaded && user ? user.firstName || user.fullName || "Guest" : "Guest";

  return (
    <header className={styles.topBar}>
      <Link href="/profile" className={styles.userInfo}>
        <UserButton 
          afterSignOutUrl="/"
          appearance={{
            baseTheme: dark,
            elements: {
              avatarBox: {
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.12)"
              }
            }
          }}
        />
        <div>
          <p className={styles.greeting}>{greeting},</p>
          <h1 className={styles.name}>{displayName}</h1>
        </div>
      </Link>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Link href="/society" className={styles.iconBtn}>
          <Users size={24} />
        </Link>
        <Link href="/blend" className={styles.iconBtn}>
          <Waves size={24} />
        </Link>
        <button className={styles.iconBtn}>
          <Bell size={24} />
        </button>
      </div>
    </header>
  );
}
