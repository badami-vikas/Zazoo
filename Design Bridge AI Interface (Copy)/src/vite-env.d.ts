/// <reference types="vite/client" />

// leaflet ships without bundled types; treat as an untyped module
// (avoids adding an @types/leaflet dependency that would surface unrelated errors).
declare module 'leaflet';
