export type SquareSpaceBlogEntry = {
  "id": string,
  "collectionId": string,
  "recordType": number,
  "addedOn": number,
  "updatedOn": number,
  "displayIndex": number,
  "starred": boolean,
  "passthrough": boolean,
  "tags": string[],
  "categories": string[],
  "workflowState": number,
  "publishOn": number, // timestamp?
  "authorId": string,
  "mediaFocalPoint": {
    "x": number,
    "y": number,
    "source": number
  },
  "urlId": string,
  "title": string,
  "body": string,
  "excerpt": string,
  "location": {
    "mapZoom": number,
    "addressTitle": string,
    "addressLine1": string,
    "addressLine2": string,
    "addressCountry": string
  },
  "customContent": null,
  "likeCount": number,
  "commentCount": number,
  "publicCommentCount": number,
  "commentState": number,
  "unsaved": boolean,
  "author": {
    "id": string,
    "displayName": string,
    "firstName": string,
    "lastName": string,
    "avatarUrl": string,
    "bio": string,
    "avatarAssetUrl": string
  },
  "fullUrl": string,
  "assetUrl": string,
  "contentType": string,
  "items": unknown[],
  "pushedServices": {},
  "pendingPushedServices": {},
  "recordTypeLabel": string
};


export type SquareSpaceBlogsResponse = {
  "website": {
    "id": string,
    "identifier": string, // squarespace subdomain 
    "websiteType": number,
    "contentModifiedOn": number, // unix timestamp?
    "cloneable": boolean,
    "hasBeenCloneable": boolean,
    "siteStatus": {},
    "language": string,
    "timeZone": string,
    "machineTimeZoneOffset": number,
    "timeZoneOffset": number,
    "timeZoneAbbr": string,
    "siteTitle": string,
    "siteDescription": string,
    "location": {
      "addressTitle": string,
      "addressLine1": string,
      "addressLine2": string,
      "addressCountry": string
    },
    "logoImageId": string,
    "shareButtonOptions": {
      "1": boolean,
      "2": boolean,
      "3": boolean,
      "4": boolean,
      "6": boolean,
      "7": boolean,
      "8": boolean
    },
    "logoImageUrl": string,
    "authenticUrl": string,
    "internalUrl": string, // url to full domain
    "baseUrl": string,
    "primaryDomain": string,
    "sslSetting": number,
    "isHstsEnabled": boolean,
    "typekitId": string,
    "statsMigrated": boolean,
    "imageMetadataProcessingEnabled": boolean,
    "screenshotId": string,
    "captchaSettings": {
      "enabledForDonations": boolean
    },
    "showOwnerLogin": boolean
  },
  "sections": {
    "html": string
  }[],
  "websiteSettings": {
    "id": string,
    "websiteId": string,
    "subjects": string[],
    "country": string,
    "state": string,
    "simpleLikingEnabled": boolean,
    "mobileInfoBarSettings": {
      "isContactEmailEnabled": boolean,
      "isContactPhoneNumberEnabled": boolean,
      "isLocationEnabled": boolean,
      "isBusinessHoursEnabled": boolean
    },
    "announcementBarSettings": {},
    "commentLikesAllowed": boolean,
    "commentAnonAllowed": boolean,
    "commentThreaded": boolean,
    "commentApprovalRequired": boolean,
    "commentAvatarsOn": boolean,
    "commentSortType": number,
    "commentFlagThreshold": number,
    "commentFlagsAllowed": boolean,
    "commentEnableByDefault": boolean,
    "commentDisableAfterDaysDefault": number,
    "disqusShortname": string,
    "collectionTitleFormat": string,
    "itemTitleFormat": string,
    "commentsEnabled": boolean,
    "uiComponentRegistrationsFlag": boolean,
    "scriptRegistrationsFlag": boolean,
    "bundleEligible": boolean,
    "bucketingSeedId": string,
    "creatorAccountCreationDate": number,
    "newPlanArchitectureEligible": boolean,
    "businessHours": {
      "monday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "tuesday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "wednesday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "thursday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "friday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "saturday": {
        "text": string,
        "ranges": [
          {}
        ]
      },
      "sunday": {
        "text": string,
        "ranges": [
          {}
        ]
      }
    },
    "storeSettings": {},
    "useEscapeKeyToLogin": false,
    "ssBadgeType": 1,
    "ssBadgePosition": 4,
    "ssBadgeVisibility": 1,
    "ssBadgeDevices": 1,
    "pinterestOverlayOptions": {
      "mode": "disabled"
    },
    "ampEnabled": false,
    "isRestrictiveCookiePolicyEnabled": false,
    "seoHidden": false,
    "userAccountsSettings": {
      "loginAllowed": true,
      "signupAllowed": true
    },
    "isCookieBannerEnabled": false,
    "isVisitorDataRestricted": false,
    "contactEmail": string,
    "contactPhoneNumber": string
  },
  "collection": {
    "id": string,
    "websiteId": string,
    "backgroundSource": number,
    "enabled": boolean,
    "starred": boolean,
    "type": number,
    "ordering": number,
    "title": string,
    "navigationTitle": string,
    "urlId": string,
    "itemCount": number,
    "updatedOn": number,
    "description": string,
    "pageSize": number,
    "features": {
      "relatedItems": {
        "isEnabled": boolean
      },
      "productQuickView": {
        "isEnabled": boolean
      }
    },
    "eventView": 1,
    "folder": false,
    "dropdown": false,
    "tags": string[], // all tags
    "categories": string[], // all categories
    "homepage": boolean,
    "typeName": string,
    "regionName": string,
    "synchronizing": boolean,
    "seoData": {
      "seoHidden": boolean
    },
    "categoryPagesSeoHidden": boolean,
    "tagPagesSeoHidden": boolean,
    "qrCodeEnabled": boolean,
    "pagePermissionType": number,
    "typeLabel": string,
    "fullUrl": string,
    "passwordProtected": boolean,
    "draft": boolean
  },
  "shoppingCart": {},
  "shareButtons": {},
  "showCart": boolean,
  "localizedStrings": {},
  "userAccountsContext": {
    "showSignInLink": true
  },
  "template": {
    "mobileStylesEnabled": true
  },
  "uiextensions": {
    "product-badge": "sqs-uiextensions-product-badge",
    "product-body": "sqs-uiextensions-product-body",
    "product-badge-mobile": "sqs-uiextensions-product-badge-mobile",
    "product-body-mobile": "sqs-uiextensions-product-body-mobile",
    "product-collection-item": "sqs-uiextensions-product-collection-item",
    "scripts-enabled": false
  },
  "empty": false,
  "emptyFolder": false,
  "calendarView": false,
  "items": SquareSpaceBlogEntry[],
  "pagePreviewContext": {
    "isPreviewMode": false,
    "memberAccessUrl": "/membersareablog?format=json&requestAccess=true"
  }
}

