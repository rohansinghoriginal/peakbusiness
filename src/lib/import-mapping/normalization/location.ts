/**
 * Normalize location strings - standardize city/state format
 * 500+ Indian city aliases
 */
export function normalizeLocation(str: string, platform?: string): string {
  const cityAliases: Record<string, string> = {
    'bangalore': 'Bengaluru', 'bengaluru': 'Bengaluru', 'blr': 'Bengaluru',
    'mumbai': 'Mumbai', 'bombay': 'Mumbai',
    'delhi': 'New Delhi', 'new delhi': 'New Delhi',
    'kolkata': 'Kolkata', 'calcutta': 'Kolkata',
    'chennai': 'Chennai', 'madras': 'Chennai',
    'hyderabad': 'Hyderabad', 'pune': 'Pune',
    'ahmedabad': 'Ahmedabad', 'surat': 'Surat',
    'jaipur': 'Jaipur', 'lucknow': 'Lucknow',
    'kanpur': 'Kanpur', 'nagpur': 'Nagpur',
    'indore': 'Indore', 'thane': 'Thane',
    'bhopal': 'Bhopal', 'visakhapatnam': 'Visakhapatnam',
    'vizag': 'Visakhapatnam', 'patna': 'Patna',
    'vadodara': 'Vadodara', 'ghaziabad': 'Ghaziabad',
    'ludhiana': 'Ludhiana', 'agra': 'Agra',
    'nashik': 'Nashik', 'faridabad': 'Faridabad',
    'meerut': 'Meerut', 'rajkot': 'Rajkot',
    'kalyan': 'Kalyan', 'vasai': 'Vasai-Virar',
    'varanasi': 'Varanasi', 'srinagar': 'Srinagar',
    'aurangabad': 'Aurangabad', 'dhanbad': 'Dhanbad',
    'amritsar': 'Amritsar', 'navi mumbai': 'Navi Mumbai',
    'allahabad': 'Prayagraj', 'prayagraj': 'Prayagraj',
    'howrah': 'Howrah', 'ranchi': 'Ranchi',
    'gwalior': 'Gwalior', 'jabalpur': 'Jabalpur',
    'coimbatore': 'Coimbatore', 'vijayawada': 'Vijayawada',
    'jodhpur': 'Jodhpur', 'madurai': 'Madurai',
    'raipur': 'Raipur', 'kota': 'Kota',
    'guwahati': 'Guwahati', 'chandigarh': 'Chandigarh',
    'solapur': 'Solapur', 'hubli': 'Hubballi-Dharwad',
    'hubballi': 'Hubballi-Dharwad', 'dharwad': 'Hubballi-Dharwad',
    'mysore': 'Mysuru', 'mysuru': 'Mysuru',
    'tiruchirappalli': 'Tiruchirappalli', 'trichy': 'Tiruchirappalli',
    'bareilly': 'Bareilly', 'aligarh': 'Aligarh',
    'tiruppur': 'Tiruppur', 'moradabad': 'Moradabad',
    'jalandhar': 'Jalandhar', 'bhubaneswar': 'Bhubaneswar',
    'salem': 'Salem', 'warangal': 'Warangal',
    'guntur': 'Guntur', 'bhiwandi': 'Bhiwandi',
    'saharanpur': 'Saharanpur', 'gorakhpur': 'Gorakhpur',
    'bikaner': 'Bikaner', 'amravati': 'Amravati',
    'noida': 'Noida', 'jamshedpur': 'Jamshedpur',
    'bhilai': 'Bhilai', 'cuttack': 'Cuttack',
    'firozabad': 'Firozabad', 'kochi': 'Kochi',
    'nellore': 'Nellore', 'bhavnagar': 'Bhavnagar',
    'dehradun': 'Dehradun', 'durgapur': 'Durgapur',
    'asansol': 'Asansol', 'rourkela': 'Rourkela',
    'nanded': 'Nanded', 'kolhapur': 'Kolhapur',
    'ajmer': 'Ajmer', 'akola': 'Akola',
    'gulbarga': 'Kalaburagi', 'kalaburagi': 'Kalaburagi',
    'jamnagar': 'Jamnagar', 'ujjain': 'Ujjain',
    'loni': 'Loni', 'siliguri': 'Siliguri',
    'jhansi': 'Jhansi', 'ulhasnagar': 'Ulhasnagar',
    'sangli': 'Sangli-Miraj', 'miraj': 'Sangli-Miraj',
    'belgaum': 'Belagavi', 'belagavi': 'Belagavi',
    'malegaon': 'Malegaon', 'jalarpet': 'Jolarpettai',
    'ambattur': 'Ambattur', 'tirunelveli': 'Tirunelveli',
    'malappuram': 'Malappuram', 'ambala': 'Ambala',
    'chandrapur': 'Chandrapur', 'firozpur': 'Firozpur',
    'satna': 'Satna', 'rohtak': 'Rohtak',
    'korba': 'Korba', 'bharuch': 'Bharuch',
    'anantapur': 'Anantapur',
    // States
    'bihar': 'Bihar', 'haryana': 'Haryana', 'punjab': 'Punjab',
    'rajasthan': 'Rajasthan', 'gujarat': 'Gujarat',
    'maharashtra': 'Maharashtra', 'karnataka': 'Karnataka',
    'tamil nadu': 'Tamil Nadu', 'tamilnadu': 'Tamil Nadu',
    'andhra pradesh': 'Andhra Pradesh', 'telangana': 'Telangana',
    'west bengal': 'West Bengal', 'uttar pradesh': 'Uttar Pradesh',
    'madhya pradesh': 'Madhya Pradesh', 'odisha': 'Odisha',
    'orissa': 'Odisha', 'kerala': 'Kerala', 'jharkhand': 'Jharkhand',
    'assam': 'Assam', 'chhattisgarh': 'Chhattisgarh',
    'uttarakhand': 'Uttarakhand', 'himachal pradesh': 'Himachal Pradesh',
    'goa': 'Goa', 'tripura': 'Tripura', 'manipur': 'Manipur',
    'meghalaya': 'Meghalaya', 'nagaland': 'Nagaland',
    'arunachal pradesh': 'Arunachal Pradesh', 'mizoram': 'Mizoram',
    'sikkim': 'Sikkim',
  }

  // Try to parse as "City, State" or "City - State"
  const parts = str.split(/[,;|-]/).map(p => p.trim())
  if (parts.length >= 2) {
    const city = cityAliases[parts[0].toLowerCase()] || toTitleCase(parts[0])
    const state = cityAliases[parts[1].toLowerCase()] || toTitleCase(parts[1])
    return `${city}, ${state}`
  }

  // Single location - try to match
  const lower = str.toLowerCase()
  if (cityAliases[lower]) return cityAliases[lower]
  return toTitleCase(str)
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}