'use client';

import { useEffect } from 'react';

export function OperationsRedirect() {
  useEffect(() => { window.location.replace('/projects'); }, []);
  return <main id="main-content"><p>Opening <a href="/projects">Projects</a>…</p></main>;
}
