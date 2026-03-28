import Papa from 'papaparse';
import { useState, useEffect, useMemo } from 'react';
import HotspotMap from './components/Map';

function App() {
  const [fileName, setFileName] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [selectedState, setSelectedState] = useState("AU-ACT");
  const [selectedCounty, setSelectedCounty] = useState("");
  const [hotspots, setHotspots] = useState<any[]>([]);
  const [showUnvisitedOnly, setShowUnvisitedOnly] = useState(false);

  function handleFileUpload(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setData(results.data as any[]);
      }
    });
  }

  useEffect(() => {
    setSelectedCounty("");
  }, [selectedState]);

  // 🌍 Dynamic hotspot fetch
  useEffect(() => {
    if (!selectedState) return;

    async function fetchHotspots() {
      try {
        const res = await fetch(
          `https://api.ebird.org/v2/ref/hotspot/${selectedState}?fmt=json`,
          {
            headers: {
              "X-eBirdApiToken": "o5mp766m7big",
              "Accept": "application/json"
            }
          }
        );

        const data = await res.json();
        setHotspots(data);
      } catch (err) {
        console.error(err);
      }
    }

    fetchHotspots();
  }, [selectedState]);

  // Dropdowns
  const states = Array.from(
    new Set(data.map(r => r["State/Province"]?.trim()).filter(Boolean))
  ).sort();

  const counties = Array.from(
    new Set(
      data
        .filter(r => !selectedState || r["State/Province"] === selectedState)
        .map(r => r["County"]?.trim())
        .filter(Boolean)
    )
  ).sort();

  const filteredData = data.filter(r =>
    (!selectedState || r["State/Province"] === selectedState) &&
    (!selectedCounty || r["County"] === selectedCounty)
  );

  const visitedHotspots = new Set(
    filteredData
      .map(r => r["Location ID"]?.trim())
      .filter((id: any) => id && id.startsWith("L"))
  );

  // Completion
  const visitedCount = hotspots.filter(h =>
    visitedHotspots.has(h.locId)
  ).length;

  const completion =
    hotspots.length > 0
      ? Math.round((visitedCount / hotspots.length) * 100)
      : 0;

  return (
  <div style={{ padding: '16px', height: '100vh', boxSizing: 'border-box' }}>
    
    <div style={{ display: 'flex', height: '100%' }}>

      {/* SIDEBAR */}
      <div style={{
        width: '300px',
        padding: '20px',
        background: '#1e1e1e',
        color: 'white',
        borderRadius: '8px'
      }}>
        <h2>eBird Hotspots</h2>

        <input type="file" accept=".csv" onChange={handleFileUpload} />
        {fileName && <p>Uploaded: {fileName}</p>}

        <br />

        <label>State:</label>
        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          style={{ width: '100%' }}
        >
          {states.map(s => <option key={s}>{s}</option>)}
        </select>

        <br /><br />

        <label>County:</label>
        <select
          value={selectedCounty}
          onChange={(e) => setSelectedCounty(e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="">All</option>
          {counties.map(c => <option key={c}>{c}</option>)}
        </select>

        <br /><br />

        <p>Visited: {visitedHotspots.size}</p>
        <p><strong>Completion: {completion}%</strong></p>

        <label>
          <input
            type="checkbox"
            checked={showUnvisitedOnly}
            onChange={(e) => setShowUnvisitedOnly(e.target.checked)}
          />
          {' '}Only unvisited
        </label>
      </div>

      {/* GAP BETWEEN SIDEBAR + MAP */}
      <div style={{ width: '16px' }} />

      {/* MAP AREA */}
      <div style={{ flex: 1, borderRadius: '8px', overflow: 'hidden' }}>
        <HotspotMap
          hotspots={
            showUnvisitedOnly
              ? hotspots.filter(h => !visitedHotspots.has(h.locId))
              : hotspots
          }
          visitedHotspots={visitedHotspots}
        />
      </div>



    </div>
  </div>
);
}

export default App;