import Papa from 'papaparse';
import { useState, useEffect, useMemo } from 'react';
import HotspotMap from './components/Map';

function App() {
  const [fileName, setFileName] = useState<string>("");
  const [data, setData] = useState<any[]>([]);
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedCounty, setSelectedCounty] = useState<string>("");

  const [hotspots, setHotspots] = useState<any[]>([]);

  function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as any[];
        setData(rows);

        console.log("CSV loaded:", rows.length, "rows");
      }
    });
  }

  useEffect(() => {
    setSelectedCounty("");
  }, [selectedState]);

  // Fetch hotspots
  useEffect(() => {
    async function fetchHotspots() {
      try {
        const res = await fetch(
          "https://api.ebird.org/v2/ref/hotspot/AU-ACT?fmt=json",
          {
            headers: {
              "X-eBirdApiToken": "o5mp766m7big",
              "Accept": "application/json"
            }
          }
        );

        const data = await res.json();
        setHotspots(data);

        console.log("Hotspots fetched:", data.length);
      } catch (err) {
        console.error("Error fetching hotspots:", err);
      }
    }

    fetchHotspots();
  }, []);

  // Dropdowns
  const states = Array.from(
    new Set(
      data.map(row => row["State/Province"]?.trim()).filter(Boolean)
    )
  ).sort();

  const counties = Array.from(
    new Set(
      data
        .filter(row =>
          !selectedState || row["State/Province"] === selectedState
        )
        .map(row => row["County"]?.trim())
        .filter(Boolean)
    )
  ).sort();

  // Filter CSV
  const filteredData = data.filter(row => (
    (!selectedState || row["State/Province"] === selectedState) &&
    (!selectedCounty || row["County"] === selectedCounty)
  ));

  // Build lookup
  const hotspotRegionMap = useMemo(() => {
    const map: Map<string, { state: string; county: string }> = new Map();

    data.forEach(row => {
      const locId = row["Location ID"]?.trim();
      const state = row["State/Province"]?.trim();
      const county = row["County"]?.trim();

      if (locId && locId.startsWith("L")) {
        map.set(locId, { state, county });
      }
    });

    return map;
  }, [data]);

  // ✅ FIXED: show ALL hotspots (not just visited)
  const filteredHotspots = hotspots.filter(h => {
    const region = hotspotRegionMap.get(h.locId);

    // If never visited, still include it
    if (!region) return true;

    return (
      (!selectedState || region.state === selectedState) &&
      (!selectedCounty || region.county === selectedCounty)
    );
  });

  // Visited set
  const visitedHotspots = new Set(
    filteredData
      .map(row => row["Location ID"]?.trim())
      .filter(id => id && id.startsWith("L"))
  );

  // ✅ FIXED completion
  const totalHotspots = filteredHotspots.length;

  const completion =
    totalHotspots > 0
      ? Math.round((visitedHotspots.size / totalHotspots) * 100)
      : 0;

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Upload your eBird CSV</h2>

      <input type="file" accept=".csv" onChange={handleFileUpload} />

      {fileName && <p>Uploaded: {fileName}</p>}

      <br /><br />

      <label>State/Province:</label>
      <select
        value={selectedState}
        onChange={(e) => setSelectedState(e.target.value)}
      >
        <option value="">All States</option>
        {states.map(state => (
          <option key={state}>{state}</option>
        ))}
      </select>

      <br /><br />

      <label>County:</label>
      <select
        value={selectedCounty}
        onChange={(e) => setSelectedCounty(e.target.value)}
      >
        <option value="">All Counties</option>
        {counties.map(county => (
          <option key={county}>{county}</option>
        ))}
      </select>

      <p>Visited hotspots: {visitedHotspots.size}</p>
      <p><strong>Completion: {completion}%</strong></p>

      <HotspotMap
        hotspots={filteredHotspots}
        visitedHotspots={visitedHotspots}
      />
    </div>
  );
}

export default App;