'use strict';
// Definitions of every admin-managed content type.
const ContentModel = require('./ContentModel');

const active = { type: 'bool', default: 1 };

const Testimonial = new ContentModel({
  table: 'testimonials',
  orderBy: 'id DESC',
  schema: {
    name:      { type: 'text', max: 120, required: true, label: 'Name' },
    role:      { type: 'text', max: 120 },
    city:      { type: 'text', max: 80 },
    rating:    { type: 'int', min: 1, max: 5, default: 5 },
    text:      { type: 'text', max: 1000, required: true, label: 'Quote' },
    is_active: active,
  },
});

const TeamMember = new ContentModel({
  table: 'team_members',
  orderBy: 'order_idx ASC, id ASC',
  imageField: 'image',
  schema: {
    name:      { type: 'text', max: 120, required: true, label: 'Name' },
    role:      { type: 'text', max: 120, required: true, label: 'Role' },
    bio:       { type: 'text', max: 1000 },
    email:     { type: 'email', max: 200, label: 'email address' },
    phone:     { type: 'phone' },
    order_idx: { type: 'int', min: 0, max: 9999, default: 0 },
    is_active: active,
    image:     { type: 'image' },
  },
});

// "Explore by city" tiles on the home page
const City = new ContentModel({
  table: 'cities',
  orderBy: 'order_idx ASC, id ASC',
  imageField: 'image',
  schema: {
    name:      { type: 'text', max: 60, required: true, label: 'City name' },
    state:     { type: 'text', max: 60 },
    order_idx: { type: 'int', min: 0, max: 9999, default: 0 },
    is_active: active,
    image:     { type: 'image' },
  },
});

const Event = new ContentModel({
  table: 'events',
  orderBy: 'event_date DESC, id DESC',
  imageField: 'image',
  schema: {
    title:       { type: 'text', max: 200, required: true, label: 'Title' },
    description: { type: 'text', max: 2000 },
    event_date:  { type: 'date' },
    location:    { type: 'text', max: 200 },
    is_active:   active,
    image:       { type: 'image' },
  },
});

const Announcement = new ContentModel({
  table: 'announcements',
  orderBy: 'created_at DESC, id DESC',
  schema: {
    title:     { type: 'text', max: 200, required: true, label: 'Title' },
    body:      { type: 'text', max: 500 },
    type:      { type: 'enum', values: ['info', 'promo', 'warning'], default: 'info' },
    is_active: active,
  },
});

const Scheme = new ContentModel({
  table: 'schemes',
  orderBy: 'created_at DESC, id DESC',
  imageField: 'image',
  schema: {
    title:       { type: 'text', max: 200, required: true, label: 'Title' },
    description: { type: 'text', max: 2000 },
    valid_until: { type: 'date' },
    is_active:   active,
    image:       { type: 'image' },
  },
});

const SocialPost = new ContentModel({
  table: 'social_posts',
  orderBy: 'created_at DESC, id DESC',
  imageField: 'image',
  publicLimit: 12,
  schema: {
    platform:  { type: 'enum', values: ['instagram', 'facebook', 'linkedin', 'youtube', 'twitter'], default: 'instagram' },
    caption:   { type: 'text', max: 500 },
    url:       { type: 'url', max: 500 },
    is_active: active,
    image:     { type: 'image' },
  },
});

const Media = new ContentModel({
  table: 'media_gallery',
  orderBy: 'created_at DESC, id DESC',
  imageField: 'filename',
  imageRequired: true,
  hasActive: false,
  schema: {
    caption:  { type: 'text', max: 200 },
    category: { type: 'enum', values: ['general', 'projects', 'events', 'office', 'interiors'], default: 'general' },
    filename: { type: 'image' },
  },
});

module.exports = { Testimonial, TeamMember, City, Event, Announcement, Scheme, SocialPost, Media };
