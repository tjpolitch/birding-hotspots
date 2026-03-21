import Papa from 'papaparse';
import { useState, useEffect } from 'react';
import Map from './components/Map';

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

  // Reset county when state changes
  useEffect(() => {
    setSelectedCounty("");
  }, [selectedState]);

  // Fetch hotspots (ACT for now)
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

  // State list
  const states = Array.from(
    new Set(
      data
        .map(row => row["State/Province"]?.trim())
        .filter(Boolean)
    )
  ).sort();

  // County list (filtered by state)
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

  // Filter data
  const filteredData = data.filter(row => {
    return (
      (!selectedState || row["State/Province"] === selectedState) &&
      (!selectedCounty || row["County"] === selectedCounty)
    );
  });

  // Visited hotspots (filtered)
  const visitedHotspots = new Set(
    filteredData
      .map(row => row["Location ID"]?.trim())
      .filter(id => id && id.startsWith("L"))
  );

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Upload your eBird CSV</h2>

      <input
        type="file"
        accept=".csv"
        onChange={handleFileUpload}
      />

      {fileName && <p>Uploaded: {fileName}</p>}

      <br /><br />

      <label style={{ marginRight: '10px' }}>State/Province:</label>
      <select
        value={selectedState}
        onChange={(e) => setSelectedState(e.target.value)}
      >
        <option value="">All States</option>
        {states.map(state => (
          <option key={state} value={state}>
            {state}
          </option>
        ))}
      </select>

      <br /><br />

      <label style={{ marginRight: '10px' }}>County:</label>
      <select
        value={selectedCounty}
        onChange={(e) => setSelectedCounty(e.target.value)}
        disabled={!data.length}
      >
        <option value="">All Counties</option>
        {counties.map(county => (
          <option key={county} value={county}>
            {county}
          </option>
        ))}
      </select>

      <p style={{ marginTop: '10px' }}>
        Visited hotspots (filtered): {visitedHotspots.size}
      </p>

      <Map
        hotspots={hotspots}
        visitedHotspots={visitedHotspots}
      />
    </div>
  );
}

export default App;