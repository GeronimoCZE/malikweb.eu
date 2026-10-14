// models/project.js
import mongoose from "mongoose";

const projectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    thumb_image: {
        type: String,
        required: true
    },

    thumb_description: {
        en: String,
        cs: String
    },

    description: {
        en: String,
        cs: String
    },

    technologies: [{
        type: String
    }],

    images: [{
        url: String,
        alt: {
            en: String,
            cs: String
        },
        // Where the picture came from, for pictures taken from the GitHub README.
        source: String
    }],

    // Shown as buttons on the project page, next to the GitHub repository.
    website: String,

    download: {
        enabled: { type: Boolean, default: false },
        url: String
    },

    // Extra buttons on the project page.
    links: [{
        title: String,
        url: String
    }],

    // The GitHub repository the project is filled from (owner/name). See src/utils/github.js.
    github: {
        repo: String,
        syncedAt: Date,
        // What GitHub said last time, so an update leaves fields edited on the admin page alone.
        imported: {
            short: String,
            description: String,
            website: String,
            download: String,
            technologies: [String],
            images: [String]
        }
    }
}, {
    // Adds createdAt / updatedAt; updatedAt becomes <lastmod> in the sitemap.
    timestamps: true
});

export const project_model =
    mongoose.models.Projects_malikweb ||
    mongoose.model("Projects_malikweb", projectSchema);