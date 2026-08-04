/**
 * MASSING — extracted from docs/design/checkitdown-map-3d.html, keyed by DB slug.
 *
 * Each property is a set of volumes offset in METRES from the room's real
 * centroid: x east, y north, w/d plan size, b bearing, h height, shape
 * box|round|pyramid, cap = roof inset for tapered towers.
 *
 * LIMITATION, and it is structural: Overpass building footprints were
 * unreachable from this environment, so these are hand-modelled approximations
 * of 18 venues plus 5 landmarks. EVERY OTHER BLOCK STAYS FLAT.
 * This is a skyline of the rooms we cover, not a model of the city.
 *
 * The offsets were authored against the module's own coordinates; they now hang
 * off the real OSM centroids in the database, which differ by up to a couple of
 * hundred metres. See scripts/map-tilt.mjs for what that does to crowding.
 */
export type Mass = {
  x: number; y: number; w: number; d: number; b: number; h: number
  shape?: 'round' | 'pyramid'; cap?: number
}

export const ROOM_MASSES: Record<string, Mass[]> = {
  "aria": [
    {
      "x": -34,
      "y": 6,
      "w": 128,
      "d": 36,
      "b": 36,
      "h": 183,
      "shape": "round"
    },
    {
      "x": 44,
      "y": 22,
      "w": 118,
      "d": 34,
      "b": 12,
      "h": 172,
      "shape": "round"
    },
    {
      "x": 4,
      "y": -64,
      "w": 186,
      "d": 86,
      "b": 22,
      "h": 26
    }
  ],
  "bellagio": [
    {
      "x": -66,
      "y": 16,
      "w": 92,
      "d": 30,
      "b": 22,
      "h": 151
    },
    {
      "x": 16,
      "y": 2,
      "w": 92,
      "d": 30,
      "b": 0,
      "h": 151
    },
    {
      "x": 96,
      "y": 20,
      "w": 82,
      "d": 30,
      "b": 340,
      "h": 138
    },
    {
      "x": 12,
      "y": -74,
      "w": 220,
      "d": 92,
      "b": 0,
      "h": 22
    }
  ],
  "horseshoe": [
    {
      "x": 0,
      "y": 24,
      "w": 112,
      "d": 32,
      "b": 10,
      "h": 92
    },
    {
      "x": 0,
      "y": -42,
      "w": 152,
      "d": 82,
      "b": 10,
      "h": 20
    }
  ],
  "caesars-palace": [
    {
      "x": -54,
      "y": 34,
      "w": 78,
      "d": 28,
      "b": 355,
      "h": 100
    },
    {
      "x": 32,
      "y": 52,
      "w": 70,
      "d": 28,
      "b": 20,
      "h": 88
    },
    {
      "x": 66,
      "y": -16,
      "w": 58,
      "d": 58,
      "b": 0,
      "h": 72,
      "shape": "round"
    },
    {
      "x": 0,
      "y": -62,
      "w": 206,
      "d": 112,
      "b": 0,
      "h": 24
    }
  ],
  "mgm-grand": [
    {
      "x": 0,
      "y": 6,
      "w": 152,
      "d": 32,
      "b": 0,
      "h": 89
    },
    {
      "x": 0,
      "y": 6,
      "w": 32,
      "d": 152,
      "b": 0,
      "h": 89
    },
    {
      "x": 0,
      "y": -84,
      "w": 212,
      "d": 120,
      "b": 0,
      "h": 22
    }
  ],
  "venetian": [
    {
      "x": 0,
      "y": 24,
      "w": 150,
      "d": 38,
      "b": 8,
      "h": 145
    },
    {
      "x": -74,
      "y": -58,
      "w": 16,
      "d": 16,
      "b": 8,
      "h": 96,
      "cap": 0.55
    },
    {
      "x": 0,
      "y": -72,
      "w": 202,
      "d": 100,
      "b": 8,
      "h": 26
    }
  ],
  "wynn-encore": [
    {
      "x": -44,
      "y": -24,
      "w": 120,
      "d": 32,
      "b": 26,
      "h": 186,
      "shape": "round"
    },
    {
      "x": 58,
      "y": 58,
      "w": 110,
      "d": 32,
      "b": 36,
      "h": 186,
      "shape": "round"
    },
    {
      "x": 0,
      "y": -72,
      "w": 182,
      "d": 92,
      "b": 26,
      "h": 24
    }
  ],
  "mandalay-bay": [
    {
      "x": 0,
      "y": 0,
      "w": 112,
      "d": 28,
      "b": 0,
      "h": 155
    },
    {
      "x": 0,
      "y": 0,
      "w": 112,
      "d": 28,
      "b": 60,
      "h": 155
    },
    {
      "x": 0,
      "y": 0,
      "w": 112,
      "d": 28,
      "b": 120,
      "h": 155
    },
    {
      "x": 0,
      "y": -96,
      "w": 200,
      "d": 112,
      "b": 340,
      "h": 22
    }
  ],
  "westgate": [
    {
      "x": 0,
      "y": 22,
      "w": 102,
      "d": 32,
      "b": 0,
      "h": 105
    },
    {
      "x": 0,
      "y": -46,
      "w": 152,
      "d": 72,
      "b": 0,
      "h": 18
    }
  ],
  "orleans": [
    {
      "x": 0,
      "y": 28,
      "w": 122,
      "d": 32,
      "b": 0,
      "h": 60
    },
    {
      "x": 0,
      "y": -36,
      "w": 172,
      "d": 102,
      "b": 0,
      "h": 16
    }
  ],
  "golden-nugget": [
    {
      "x": -32,
      "y": 12,
      "w": 70,
      "d": 28,
      "b": 0,
      "h": 60
    },
    {
      "x": 42,
      "y": 22,
      "w": 60,
      "d": 26,
      "b": 0,
      "h": 52
    },
    {
      "x": 0,
      "y": -42,
      "w": 152,
      "d": 82,
      "b": 0,
      "h": 16
    }
  ],
  "boulder-station": [
    {
      "x": 0,
      "y": 0,
      "w": 132,
      "d": 92,
      "b": 0,
      "h": 22
    },
    {
      "x": -42,
      "y": 22,
      "w": 40,
      "d": 40,
      "b": 0,
      "h": 34
    }
  ],
  "south-point": [
    {
      "x": 0,
      "y": 28,
      "w": 122,
      "d": 32,
      "b": 0,
      "h": 60
    },
    {
      "x": 0,
      "y": -36,
      "w": 172,
      "d": 102,
      "b": 0,
      "h": 16
    }
  ],
  "skyline": [
    {
      "x": 0,
      "y": 0,
      "w": 62,
      "d": 42,
      "b": 0,
      "h": 12
    }
  ],
  "green-valley-ranch": [
    {
      "x": 0,
      "y": 22,
      "w": 102,
      "d": 32,
      "b": 0,
      "h": 45
    },
    {
      "x": 0,
      "y": -32,
      "w": 152,
      "d": 92,
      "b": 0,
      "h": 14
    }
  ],
  "red-rock": [
    {
      "x": 0,
      "y": 22,
      "w": 112,
      "d": 32,
      "b": 0,
      "h": 55
    },
    {
      "x": 0,
      "y": -36,
      "w": 162,
      "d": 96,
      "b": 0,
      "h": 16
    }
  ],
  "santa-fe-station": [
    {
      "x": 0,
      "y": 0,
      "w": 132,
      "d": 86,
      "b": 0,
      "h": 22
    },
    {
      "x": -32,
      "y": 16,
      "w": 50,
      "d": 40,
      "b": 0,
      "h": 30
    }
  ],
  "wsop-paris": [
    {
      "x": 0,
      "y": 0,
      "w": 44,
      "d": 44,
      "b": 0,
      "h": 165,
      "shape": "pyramid"
    },
    {
      "x": 34,
      "y": -58,
      "w": 154,
      "d": 82,
      "b": 0,
      "h": 52
    }
  ]
}

export const LANDMARKS: Array<{ name: string; lat: number; lon: number; masses: Mass[] }> =
[
  {
    "name": "Luxor",
    "lat": 36.0955,
    "lon": -115.1761,
    "masses": [
      {
        "x": 0,
        "y": 0,
        "w": 150,
        "d": 150,
        "b": 0,
        "h": 107,
        "shape": "pyramid"
      }
    ]
  },
  {
    "name": "Excalibur",
    "lat": 36.0987,
    "lon": -115.1753,
    "masses": [
      {
        "x": 0,
        "y": 0,
        "w": 150,
        "d": 110,
        "b": 0,
        "h": 34
      },
      {
        "x": -56,
        "y": 40,
        "w": 20,
        "d": 20,
        "b": 0,
        "h": 66,
        "shape": "round",
        "cap": 0.4
      },
      {
        "x": 56,
        "y": 40,
        "w": 20,
        "d": 20,
        "b": 0,
        "h": 66,
        "shape": "round",
        "cap": 0.4
      },
      {
        "x": -56,
        "y": -40,
        "w": 20,
        "d": 20,
        "b": 0,
        "h": 60,
        "shape": "round",
        "cap": 0.4
      },
      {
        "x": 56,
        "y": -40,
        "w": 20,
        "d": 20,
        "b": 0,
        "h": 60,
        "shape": "round",
        "cap": 0.4
      }
    ]
  },
  {
    "name": "New York-New York",
    "lat": 36.1024,
    "lon": -115.1745,
    "masses": [
      {
        "x": -40,
        "y": 20,
        "w": 38,
        "d": 38,
        "b": 12,
        "h": 150,
        "cap": 0.5
      },
      {
        "x": 6,
        "y": 0,
        "w": 34,
        "d": 34,
        "b": 12,
        "h": 120,
        "cap": 0.55
      },
      {
        "x": 44,
        "y": 26,
        "w": 30,
        "d": 30,
        "b": 12,
        "h": 96,
        "cap": 0.6
      },
      {
        "x": 20,
        "y": -46,
        "w": 130,
        "d": 60,
        "b": 12,
        "h": 44
      }
    ]
  },
  {
    "name": "Stratosphere",
    "lat": 36.1474,
    "lon": -115.1556,
    "masses": [
      {
        "x": 0,
        "y": 0,
        "w": 26,
        "d": 26,
        "b": 0,
        "h": 350,
        "shape": "round",
        "cap": 0.35
      }
    ]
  },
  {
    "name": "T-Mobile Arena",
    "lat": 36.1028,
    "lon": -115.1784,
    "masses": [
      {
        "x": 0,
        "y": 0,
        "w": 140,
        "d": 110,
        "b": 20,
        "h": 40,
        "shape": "round"
      }
    ]
  }
]
