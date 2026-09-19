export interface Coordinates {
  lat: number;
  lng: number;
}

// GeolocationPositionError.message is often blank or too technical
// ("kCLErrorLocationUnknown") to show a farmer, so map the standard codes
// to plain language and fall back to the raw message otherwise.
function describeGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location access was denied — enable it for this site in your browser's settings and try again.";
    case err.POSITION_UNAVAILABLE:
      return "Your location couldn't be determined right now.";
    case err.TIMEOUT:
      return "Finding your location took too long — try again.";
    default:
      return err.message || "Couldn't get your location.";
  }
}

// Wraps the callback-based browser Geolocation API in a Promise. Rejects
// (rather than falling back silently) so callers can decide what to show —
// e.g. keep the map on its default center if the farmer denies permission.
export function getCurrentLocation(
  options: PositionOptions = { enableHighAccuracy: true, timeout: 8000 }
): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(describeGeolocationError(err))),
      options
    );
  });
}
