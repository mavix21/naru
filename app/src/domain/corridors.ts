// Ordered [longitude, latitude] traces of the named roads, based on OpenStreetMap.
// These are curated map geometries, not turn-by-turn driving directions.
export type GeographicPoint = readonly [longitude: number, latitude: number];

export type CorridorRoute = {
  id: string;
  name: string;
  direction: string;
  origin: string;
  destination: string;
  points: readonly GeographicPoint[];
};

export type Corridor = {
  id: string;
  name: string;
  routes: readonly CorridorRoute[];
};

export const corridors: readonly Corridor[] = [
  {
    id: "javier-prado",
    name: "Javier Prado",
    routes: [
      {
        id: "javier-prado-arequipa-monitor-eastbound",
        name: "Javier Prado · Arequipa → Óvalo Monitor",
        direction: "Oeste → este",
        origin: "Av. Arequipa",
        destination: "Óvalo Monitor",
        points: [
          [-77.033499, -12.092356],
          [-77.032197, -12.092173],
          [-77.024231, -12.091045],
          [-77.01888, -12.090339],
          [-77.014658, -12.090176],
          [-77.00781, -12.088888],
          [-76.995532, -12.087179],
          [-76.987906, -12.086001],
          [-76.985698, -12.085308],
          [-76.97826, -12.084351],
          [-76.970445, -12.083745],
        ],
      },
    ],
  },
  {
    id: "avenida-arequipa",
    name: "Avenida Arequipa",
    routes: [
      {
        id: "avenida-arequipa-28-julio-miraflores-southbound",
        name: "Avenida Arequipa · 28 de Julio → Óvalo de Miraflores",
        direction: "Norte → sur",
        origin: "Av. 28 de Julio",
        destination: "Óvalo de Miraflores",
        points: [
          [-77.037447, -12.0649],
          [-77.037137, -12.067269],
          [-77.036713, -12.069002],
          [-77.036364, -12.071305],
          [-77.035961, -12.073932],
          [-77.035358, -12.077943],
          [-77.035136, -12.080605],
          [-77.033636, -12.090738],
          [-77.032779, -12.095601],
          [-77.031653, -12.103591],
          [-77.031068, -12.106101],
          [-77.02955, -12.115002],
          [-77.029182, -12.119032],
        ],
      },
    ],
  },
  {
    id: "via-expresa",
    name: "Vía Expresa",
    routes: [
      {
        id: "via-expresa-javier-prado-benavides-southbound",
        name: "Vía Expresa · Javier Prado → Benavides",
        direction: "Norte → sur",
        origin: "Av. Javier Prado",
        destination: "Av. Benavides",
        points: [
          [-77.023013, -12.091972],
          [-77.02484, -12.09607],
          [-77.026849, -12.100389],
          [-77.027507, -12.10317],
          [-77.027481, -12.105596],
          [-77.02659, -12.108278],
          [-77.026142, -12.112063],
          [-77.026277, -12.117697],
          [-77.025209, -12.122075],
          [-77.024352, -12.125055],
        ],
      },
    ],
  },
];
