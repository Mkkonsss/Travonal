import type { NormalizedPlace } from './place-model';

export function buildPlaceDetailUrl(
  place: NormalizedPlace,
  ctx: { destination?: string; tripId?: string; day?: string | number } = {},
): string {
  const params: [string, string][] = [['name', place.name]];
  if (place.placeId) params.push(['placeId', place.placeId]);
  if (place.address) params.push(['address', place.address]);
  if (place.description) params.push(['description', place.description]);
  if (place.rating != null) params.push(['rating', String(place.rating)]);
  if (place.reviewCount != null) params.push(['reviewCount', String(place.reviewCount)]);
  if (place.lat != null) params.push(['lat', String(place.lat)]);
  if (place.lng != null) params.push(['lng', String(place.lng)]);
  if (place.category) params.push(['category', place.category]);
  if (place.website) params.push(['website', place.website]);
  if (place.phone) params.push(['phone', place.phone]);
  if (place.openingHours?.length) params.push(['hours', JSON.stringify(place.openingHours)]);
  if (place.priceLevel != null) params.push(['priceLevel', String(place.priceLevel)]);
  if (place.googleMapsUri) params.push(['googleMapsUri', place.googleMapsUri]);
  if (place.openNow != null) params.push(['openNow', String(place.openNow)]);
  if (place.photos?.[0]?.reference) params.push(['photoRef', place.photos[0].reference]);
  if (ctx.destination) params.push(['destination', ctx.destination]);
  if (ctx.tripId) params.push(['tripId', ctx.tripId]);
  if (ctx.tripId && ctx.day != null) params.push(['day', String(ctx.day)]);
  return '/place-detail?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
