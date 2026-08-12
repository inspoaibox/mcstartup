# Get all orders Token API 
  
POST  `https://marketplace.walmartapis.com/v3/token` 

Retrieves the details of all the orders for specified search criteria. The same API can be used to search a single order based on purchaseOrderId/ customerOrderId This API supports only upto an offset of 1000 in response with max limit 100 orders. You can use cursor based API instead to get all the orders.

URL : `https://marketplace.walmartapis.com/v3/orders `  
   

```cURL Request  
curl --request GET \
     --url https://marketplace.walmartapis.com/v3/orders \
     --header 'accept: application/json'
```


### ` `200       

```
{
  "meta": {
    "totalCount": 40,
    "limit": 5
  },
  "order": [
    {
      "purchaseOrderId": "P100263684",
      "customerOrderId": "20210420154",
      "customerEmailId": "Amrit.Krishan@walmartlabs.com",
      "orderDate": "2021-04-20T08:43:33.000-05:00",
      "shippingInfo": {
        "phone": "57657657657654",
        "estimatedDeliveryDate": "2021-04-21T05:22:18.000-05:00",
        "postalAddress": {
          "name": "Leonardo Da Messi",
          "address1": "c�lle panoramica #5154",
          "address2": "P.O. Box: 44252",
          "address3": "NOCHISTLAN",
          "address4": "NOCHISTLAN DE MEJIA",
          "address5": "gdjgjj",
          "address6": "hgjhjhg",
          "city": "NOCHISTLAN DE MEJIA",
          "state": "ZACATECAS",
          "postalCode": "66450",
          "country": "MX"
        }
      },
      "billingInfo": {
        "phone": "57657657657654",
        "postalAddress": {
          "name": "Sindhucard",
          "address1": "c�lle panoramica #5152",
          "address2": "P.O. Box: 44250",
          "address3": "LOS ALPES",
          "address4": "ALVARO OBREGON",
          "city": "CIUDAD DE MEXICO",
          "state": "DISTRITO FEDERAL",
          "postalCode": "01010",
          "country": "MX"
        }
      },
      "totalLines": "2",
      "totalQuantity": "2",
      "orderLines": [
        {
          "primeLineNumber": "1",
          "coLineNumber": "1",
          "item": {
            "upc": "00009785509713",
            "offerId": "7A7A1699D96D4F5B8BE711DA81AD4760",
            "productName": "G600",
            "sku": "2188_00009785509713",
            "condition": "New",
            "imageUrl": "https://super.walmart.com.mx/images/product-images/img_small/00009785509713s.jpg",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Acknowledged",
              "statusCode": "3350.10",
              "statusDate": "2021-04-21T05:23:57.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210420154-1-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "N",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        },
        {
          "primeLineNumber": "2",
          "coLineNumber": "2",
          "item": {
            "upc": "00454873603331",
            "offerId": "8F01B69DE4A2495AA69C4AE815F63A34",
            "productName": "SONY 32 HD SMART",
            "sku": "2064_00454873603331",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/20faa365-d5af-40ba-bb15-d9997bed956e.a12da43c4c71f9b522d5dcb275c664ab.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Acknowledged",
              "statusCode": "3350.10",
              "statusDate": "2021-04-21T05:23:54.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210420154-2-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "Y",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        }
      ],
      "shipments": [
        {
          "shipmentLines": [
            {
              "primeLineNo": "1",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            },
            {
              "primeLineNo": "2",
              "shipmentLineNo": "2",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shipmentNo": "778315133",
          "packageNo": "778315133",
          "isSellerOwnedShipment": "N",
          "carrier": "MX-FEDX",
          "shipmentAdditionalDate": {
            "shipmentActualCreatedDate": "2021-04-21T05:22:21.000-05:00",
            "expectedShipmentACKDate": "2021-04-23T05:22:20.000-05:00",
            "shipmentACKDate": "2021-04-21T05:23:57.000-05:00",
            "expectedShipmentShippedDate": "2021-04-23T05:23:57.000-05:00"
          }
        }
      ],
      "orderTotal": {
        "currency": "MXN",
        "amount": "14398"
      },
      "rfc": "EUPD8309134N4",
      "paymentMethod": "CREDIT",
      "cfdi": "G01"
    },
    {
      "purchaseOrderId": "P100263682",
      "customerOrderId": "20210421154",
      "customerEmailId": "Amrit.Krishan@walmartlabs.com",
      "orderDate": "2021-04-20T08:43:33.000-05:00",
      "shippingInfo": {
        "phone": "57657657657654",
        "estimatedDeliveryDate": "2021-04-21T05:12:19.000-05:00",
        "postalAddress": {
          "name": "Leonardo Da Messi",
          "address1": "c�lle panoramica #5154",
          "address2": "P.O. Box: 44252",
          "address3": "NOCHISTLAN",
          "address4": "NOCHISTLAN DE MEJIA",
          "address5": "gdjgjj",
          "address6": "hgjhjhg",
          "city": "NOCHISTLAN DE MEJIA",
          "state": "ZACATECAS",
          "postalCode": "66450",
          "country": "MX"
        }
      },
      "billingInfo": {
        "phone": "57657657657654",
        "postalAddress": {
          "name": "Sindhucard",
          "address1": "c�lle panoramica #5152",
          "address2": "P.O. Box: 44250",
          "address3": "LOS ALPES",
          "address4": "ALVARO OBREGON",
          "city": "CIUDAD DE MEXICO",
          "state": "DISTRITO FEDERAL",
          "postalCode": "01010",
          "country": "MX"
        }
      },
      "totalLines": "2",
      "totalQuantity": "2",
      "orderLines": [
        {
          "primeLineNumber": "1",
          "coLineNumber": "1",
          "item": {
            "upc": "00009785509713",
            "offerId": "7A7A1699D96D4F5B8BE711DA81AD4760",
            "productName": "G600",
            "sku": "2188_00009785509713",
            "condition": "New",
            "imageUrl": "https://super.walmart.com.mx/images/product-images/img_small/00009785509713s.jpg",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:12:21.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421154-1-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "N",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        },
        {
          "primeLineNumber": "2",
          "coLineNumber": "2",
          "item": {
            "upc": "00454873603331",
            "offerId": "8F01B69DE4A2495AA69C4AE815F63A34",
            "productName": "SONY 32 HD SMART",
            "sku": "2064_00454873603331",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/20faa365-d5af-40ba-bb15-d9997bed956e.a12da43c4c71f9b522d5dcb275c664ab.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:12:23.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421154-2-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "Y",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        }
      ],
      "shipments": [
        {
          "shipmentLines": [
            {
              "primeLineNo": "1",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            },
            {
              "primeLineNo": "2",
              "shipmentLineNo": "2",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shipmentNo": "778315130",
          "packageNo": "778315130",
          "isSellerOwnedShipment": "Y",
          "carrier": "Seller_Owned",
          "shipmentAdditionalDate": {
            "shipmentActualCreatedDate": "2021-04-21T05:12:22.000-05:00",
            "expectedShipmentACKDate": "2021-04-23T05:12:21.000-05:00"
          }
        }
      ],
      "orderTotal": {
        "currency": "MXN",
        "amount": "14398"
      },
      "rfc": "EUPD8309134N4",
      "paymentMethod": "CREDIT",
      "cfdi": "G01"
    },
    {
      "purchaseOrderId": "P100263681",
      "customerOrderId": "20210421153",
      "customerEmailId": "Amrit.Krishan@walmartlabs.com",
      "orderDate": "2021-04-20T08:43:33.000-05:00",
      "shippingInfo": {
        "phone": "57657657657654",
        "estimatedDeliveryDate": "2021-04-21T05:12:18.000-05:00",
        "postalAddress": {
          "name": "Leonardo Da Messi",
          "address1": "c�lle panoramica #5154",
          "address2": "P.O. Box: 44252",
          "address3": "NOCHISTLAN",
          "address4": "NOCHISTLAN DE MEJIA",
          "address5": "gdjgjj",
          "address6": "hgjhjhg",
          "city": "NOCHISTLAN DE MEJIA",
          "state": "ZACATECAS",
          "postalCode": "66450",
          "country": "MX"
        }
      },
      "billingInfo": {
        "phone": "57657657657654",
        "postalAddress": {
          "name": "Sindhucard",
          "address1": "c�lle panoramica #5152",
          "address2": "P.O. Box: 44250",
          "address3": "LOS ALPES",
          "address4": "ALVARO OBREGON",
          "city": "CIUDAD DE MEXICO",
          "state": "DISTRITO FEDERAL",
          "postalCode": "01010",
          "country": "MX"
        }
      },
      "totalLines": "2",
      "totalQuantity": "2",
      "orderLines": [
        {
          "primeLineNumber": "2",
          "coLineNumber": "1",
          "item": {
            "upc": "00880609019889",
            "offerId": "9649947A815F4F3E8667E3A65BA757E8",
            "productName": "Smartphone Samsung Galaxy A51, 128GB/4GB RAM Negro Desbloquead",
            "sku": "TLMI98",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/24e9f131-7fb7-40a4-91ea-b73c9f56933d.9715121c2e9b6facb51307344dd0140d.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:12:20.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421153-1-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "N",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        },
        {
          "primeLineNumber": "1",
          "coLineNumber": "2",
          "item": {
            "upc": "04512403403944",
            "offerId": "B23AEB0C91984FBFAC567C3318B28EF0",
            "productName": "45124034039447",
            "sku": "4039447SSK",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/b35b9d80-8079-41ec-bf1b-ae05ce28eee0.0c7d65ce5ef44ca4b6b5cdbd93350e0c.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "20"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "10"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:12:23.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421153-2-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "Y",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        }
      ],
      "shipments": [
        {
          "shipmentLines": [
            {
              "primeLineNo": "2",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            },
            {
              "primeLineNo": "1",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shipmentNo": "778315129",
          "packageNo": "778315129",
          "isSellerOwnedShipment": "Y",
          "carrier": "Seller_Owned",
          "shipmentAdditionalDate": {
            "shipmentActualCreatedDate": "2021-04-21T05:12:21.000-05:00",
            "expectedShipmentACKDate": "2021-04-23T05:12:20.000-05:00"
          }
        }
      ],
      "orderTotal": {
        "currency": "MXN",
        "amount": "14398"
      },
      "rfc": "EUPD8309134N4",
      "paymentMethod": "CREDIT",
      "cfdi": "G01"
    },
    {
      "purchaseOrderId": "P100263680",
      "customerOrderId": "20210421152",
      "customerEmailId": "Amrit.Krishan@walmartlabs.com",
      "orderDate": "2021-04-20T08:43:33.000-05:00",
      "shippingInfo": {
        "phone": "1234567890",
        "estimatedDeliveryDate": "2021-04-21T05:02:20.000-05:00",
        "postalAddress": {
          "name": "Leonardo Da Messi",
          "address1": "c�lle panoramica #5154",
          "address2": "P.O. Box: 44252",
          "address3": "LIBERTAD",
          "address4": "Azcapotzalco",
          "city": "Ciudad de M�xico",
          "state": "Distrito Federal",
          "postalCode": "66450",
          "country": "MX"
        }
      },
      "billingInfo": {
        "postalAddress": {
          "address1": "c�lle panoramica #5152",
          "address2": "P.O. Box: 44250",
          "address3": "LIBERTAD",
          "address4": "Azcapotzalco",
          "city": "Ciudad de M�xico",
          "state": "Distrito Federal",
          "postalCode": "66450",
          "country": "MEXICO"
        }
      },
      "totalLines": "1",
      "totalQuantity": "1",
      "orderLines": [
        {
          "primeLineNumber": "1",
          "coLineNumber": "1",
          "item": {
            "upc": "00076662317735",
            "offerId": "0681AA61512A4BF19444D2C545807EA9",
            "productName": "CONV. VGA A HDMI 177351",
            "sku": "2188_00076662317735",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/49bf8851-d539-4fda-84e9-f6d120cfa0b2.4a6d3d8dcf73b8385ccda9b17ea646aa.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "50"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:02:21.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421152-1-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "N",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        }
      ],
      "shipments": [
        {
          "shipmentLines": [
            {
              "primeLineNo": "1",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shipmentNo": "778315128",
          "packageNo": "778315128",
          "isSellerOwnedShipment": "Y",
          "carrier": "Seller_Owned",
          "shipmentAdditionalDate": {
            "shipmentActualCreatedDate": "2021-04-21T05:02:22.000-05:00",
            "expectedShipmentACKDate": "2021-04-23T05:02:21.000-05:00"
          }
        }
      ],
      "orderTotal": {
        "currency": "MXN",
        "amount": "7199"
      },
      "rfc": "EUPD8309134N4",
      "paymentMethod": "CREDIT",
      "cfdi": "G01"
    },
    {
      "purchaseOrderId": "P100263679",
      "customerOrderId": "20210421151",
      "customerEmailId": "Amrit.Krishan@walmartlabs.com",
      "orderDate": "2021-04-20T08:43:33.000-05:00",
      "shippingInfo": {
        "phone": "1234567890",
        "estimatedDeliveryDate": "2021-04-21T05:02:19.000-05:00",
        "postalAddress": {
          "name": "Leonardo Da Messi",
          "address1": "c�lle panoramica #5154",
          "address2": "P.O. Box: 44252",
          "address3": "LIBERTAD",
          "address4": "Azcapotzalco",
          "city": "Ciudad de M�xico",
          "state": "Distrito Federal",
          "postalCode": "66450",
          "country": "MX"
        }
      },
      "billingInfo": {
        "postalAddress": {
          "address1": "c�lle panoramica #5152",
          "address2": "P.O. Box: 44250",
          "address3": "LIBERTAD",
          "address4": "Azcapotzalco",
          "city": "Ciudad de M�xico",
          "state": "Distrito Federal",
          "postalCode": "66450",
          "country": "MEXICO"
        }
      },
      "totalLines": "1",
      "totalQuantity": "1",
      "orderLines": [
        {
          "primeLineNumber": "1",
          "coLineNumber": "1",
          "item": {
            "upc": "00008508114331",
            "offerId": "30AB25F448EB4B52AA3504F480464F6A",
            "productName": "JUEGO DE CUBIERTOS 20 PZS ACERO INOX PULIDO EMPAQUETADO",
            "sku": "2064_00008508114331",
            "condition": "New",
            "imageUrl": "https://www-qa.walmart.com.mx/gm/3pp/asr/a6a2d8ea-8b53-4446-928a-5dd1d1c24d18.ff214fa877b8720e1121bc5dff8d33b7.jpeg?odnHeight=180&odnWidth=180&odnBg=ffffff",
            "unitPrice": {
              "currency": "MXN",
              "amount": "7199"
            }
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "50"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "-30.17"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "988.14"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "orderLineQuantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "orderLineStatus": [
            {
              "status": "Created",
              "statusCode": "3350",
              "statusDate": "2021-04-21T05:02:20.000-05:00",
              "statusQuantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shippingMethod": "STANDARD",
          "soPrimeLineSubLineNo": "20210421151-1-1",
          "promiseDeliveryDate": "2021-04-20T08:43:33.000-05:00",
          "isMSIEnabled": "N",
          "seller": {
            "id": "10900025367",
            "name": "NEW COMPANY NAME",
            "shipNodeType": "PangaeaMarketplace"
          }
        }
      ],
      "shipments": [
        {
          "shipmentLines": [
            {
              "primeLineNo": "1",
              "shipmentLineNo": "1",
              "shipFromCountry": "MX",
              "quantity": {
                "unitOfMeasurement": "EACH",
                "amount": "1"
              }
            }
          ],
          "shipmentNo": "778315127",
          "packageNo": "778315127",
          "isSellerOwnedShipment": "Y",
          "carrier": "Seller_Owned",
          "shipmentAdditionalDate": {
            "shipmentActualCreatedDate": "2021-04-21T05:02:21.000-05:00",
            "expectedShipmentACKDate": "2021-04-23T05:02:20.000-05:00"
          }
        }
      ],
      "orderTotal": {
        "currency": "MXN",
        "amount": "7199"
      },
      "rfc": "EUPD8309134N4",
      "paymentMethod": "CREDIT",
      "cfdi": "G01"
    }
  ]
}
```

# Shipping Updates

POST: `https://marketplace.walmartapis.com/v3/orders/{purchaseOrderId}/ship`

Updates the status of order lines to Shipped and trigger the charge to the customer. The response to a successful call contains the order with the shipped line items. 
Note: You can ship multiple items in a single shipment by passing the array line for each item with associated quantities you want to ship. Tracking information must be sent mandatorily.

BASE URL : `https://marketplace.walmartapis.com/v3/orders/{purchaseOrderId}/ship `  

```cURL Request
curl --request POST \
     --url https://marketplace.walmartapis.com/v3/orders/purchaseOrderId/ship \
     --header 'accept: application/json' \
     --header 'content-type: application/json'
```

   

```202  
string
```

# Refund Order Lines

POST  `https://marketplace.walmartapis.com/v3/returns/{returnOrderId}/refund` 

Refunds one or more order lines that have been shipped. The response to a successful call contains the order with the refunded line item

```
curl --request POST \
     --url https://marketplace.walmartapis.com/v3/returns/returnOrderId/refund \
     --header 'accept: application/json' \
     --header 'content-type: application/json'
```

```202
string
```

# Get Returns

Get： https://marketplace.walmartapis.com/v3/returns

Retrieves the details of all return orders for the specified filter criteria. The same API can be used to search a single order based on returnOrderId/ customerOrderId This API supports only upto an offset of 1000 in response with max limit 100 orders. If you want to fetch more than 1000 then you can use the cursor API.

```
curl --request GET \
     --url https://marketplace.walmartapis.com/v3/returns \
     --header 'accept: application/json'
```

```
{
  "meta": {
    "totalCount": 5,
    "limit": 10
  },
  "returnOrders": [
    {
      "returnOrderId": "R100643236",
      "customerEmail": "danduaparna9@gmail.com",
      "customerName": {
        "firstName": "Aparna",
        "lastName": "Dandu"
      },
      "customerOrderId": "100050881383",
      "returnOrderDate": "2021-12-28T02:41:54.000-06:00",
      "returnOrderLines": [
        {
          "returnOrderLineNumber": "2",
          "primeLineNumber": "2",
          "returnReason": "Pedido extraviado por Courrier",
          "reasonCode": "COURIER_LOST",
          "purchaseOrderId": "P100569002",
          "purchaseOrderLineNumber": "1",
          "item": {
            "upc": "00019065300019",
            "offerId": "9C9EAAE97E724107981A8F67D8E12C6A",
            "productName": "DT110",
            "sku": "SKU_28072021"
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "13.93"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "unitPrice": {
            "currency": "MXN",
            "amount": "101"
          },
          "quantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "status": "Initiated",
          "statusTime": "2021-12-28T02:42:03.000-06:00",
          "refundAmount": {
            "currency": "MXN",
            "amount": "101"
          },
          "soPrimeLineSubLineNo": "100050881383-2-1",
          "isWFSEnabled": "N"
        }
      ],
      "returnOrderShipments": [
        {
          "shipmentNo": "778549936",
          "status": "IN_TRANSIT",
          "trackingNumber": "6930427755"
        }
      ]
    },
    {
      "returnOrderId": "R100578675",
      "customerEmail": "alka.dubey@walmart.com",
      "customerName": {
        "firstName": "fname",
        "lastName": "lname"
      },
      "customerOrderId": "202111030001",
      "returnOrderDate": "2021-11-17T08:45:25.000-06:00",
      "returnOrderLines": [
        {
          "returnOrderLineNumber": "10",
          "primeLineNumber": "10",
          "returnReason": "Duda de entrega/Entrega no reconocida",
          "reasonCode": "DELIVERY_DOUBT",
          "purchaseOrderId": "P100557201",
          "purchaseOrderLineNumber": "2",
          "item": {
            "upc": "00694214743438",
            "offerId": "00694214743438",
            "productName": "HISENSE 32 H"
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "unitPrice": {
            "currency": "MXN",
            "amount": "100"
          },
          "quantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "status": "Initiated",
          "statusTime": "2021-11-17T08:45:33.000-06:00",
          "refundAmount": {
            "currency": "MXN",
            "amount": "100"
          },
          "soPrimeLineSubLineNo": "202111030001-10-1",
          "isWFSEnabled": "N"
        }
      ],
      "returnOrderShipments": [
        {
          "shipmentNo": "778485077",
          "status": "IN_TRANSIT",
          "trackingNumber": "794686913065",
          "trackingUrl": "https://www.fedex.com/apps/fedextrack/?cntry_code=mx&tab=1&tracknums=794686913065"
        }
      ]
    },
    {
      "returnOrderId": "R100575598",
      "customerEmail": "danduaparna9@gmail.com",
      "customerName": {
        "firstName": "Aparna",
        "lastName": "Dandu"
      },
      "customerOrderId": "100050879225",
      "returnOrderDate": "2021-11-15T11:33:53.000-06:00",
      "returnOrderLines": [
        {
          "returnOrderLineNumber": "1",
          "primeLineNumber": "1",
          "returnReason": "Error del Cliente",
          "reasonCode": "CUSTOMER_ERROR",
          "purchaseOrderId": "P100568938",
          "purchaseOrderLineNumber": "1",
          "item": {
            "upc": "00694214743438",
            "offerId": "0E93281A7BF64DBFA66EC2442B93B191",
            "productName": "HISENSE 32 H",
            "sku": "SKU_02082021_10900030838"
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "COUPON_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "DISCOUNT",
              "chargeName": "SHIP_DISC",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              }
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "275.86"
                  }
                },
                {
                  "taxName": "IEPS_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                },
                {
                  "taxName": "STATE_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "unitPrice": {
            "currency": "MXN",
            "amount": "2000"
          },
          "quantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "status": "Initiated",
          "statusTime": "2021-11-15T11:34:09.000-06:00",
          "refundAmount": {
            "currency": "MXN",
            "amount": "2000"
          },
          "soPrimeLineSubLineNo": "100050879225-1-1",
          "isWFSEnabled": "N"
        }
      ],
      "returnOrderShipments": [
        {
          "shipmentNo": "778482197",
          "status": "IN_TRANSIT",
          "trackingNumber": "794685789973",
          "trackingUrl": "https://www.fedex.com/apps/fedextrack/?cntry_code=mx&tab=1&tracknums=794685789973"
        }
      ]
    },
    {
      "returnOrderId": "R100535977",
      "customerEmail": "alka.dubey@walmart.com",
      "customerName": {
        "firstName": "fname",
        "lastName": "lname"
      },
      "customerOrderId": "20211020003",
      "returnOrderDate": "2021-10-20T04:46:32.000-05:00",
      "returnOrderLines": [
        {
          "returnOrderLineNumber": "1",
          "primeLineNumber": "1",
          "returnReason": "Actividad Sospechosa",
          "reasonCode": "SUSPICIOUS_ACTIVITY",
          "purchaseOrderId": "P100535817",
          "purchaseOrderLineNumber": "1",
          "item": {
            "upc": "00694214743438",
            "offerId": "00694214743438",
            "productName": "HISENSE 32 H"
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "unitPrice": {
            "currency": "MXN",
            "amount": "100"
          },
          "quantity": {
            "unitOfMeasurement": "EACH",
            "amount": "1"
          },
          "status": "Initiated",
          "statusTime": "2021-10-20T04:46:37.000-05:00",
          "refundAmount": {
            "currency": "MXN",
            "amount": "100"
          },
          "soPrimeLineSubLineNo": "20211020003-1-1",
          "isWFSEnabled": "N"
        }
      ],
      "returnOrderShipments": [
        {
          "shipmentNo": "R100535977_SHIP_1",
          "status": "IN_TRANSIT"
        }
      ]
    },
    {
      "returnOrderId": "R100535949",
      "customerEmail": "alka.dubey@walmart.com",
      "customerName": {
        "firstName": "fname",
        "lastName": "lname"
      },
      "customerOrderId": "20211020002",
      "returnOrderDate": "2021-10-20T04:39:41.000-05:00",
      "returnOrderLines": [
        {
          "returnOrderLineNumber": "1",
          "primeLineNumber": "1",
          "returnReason": "Actividad Sospechosa",
          "reasonCode": "SUSPICIOUS_ACTIVITY",
          "purchaseOrderId": "P100535812",
          "purchaseOrderLineNumber": "1",
          "item": {
            "upc": "00694214743438",
            "offerId": "00694214743438",
            "productName": "HISENSE 32 H"
          },
          "charges": [
            {
              "chargeType": "SHIPPING",
              "chargeName": "SHIPPING_CH",
              "chargeAmount": {
                "currency": "MXN",
                "amount": "0"
              },
              "tax": [
                {
                  "taxName": "SHIP_IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            },
            {
              "chargeType": "PRODUCT",
              "chargeName": "ItemPrice",
              "tax": [
                {
                  "taxName": "IVA_TAX",
                  "taxAmount": {
                    "currency": "MXN",
                    "amount": "0"
                  }
                }
              ]
            }
          ],
          "unitPrice": {
            "currency": "MXN",
            "amount": "100"
          },
          "quantity": {
            "unitOfMeasurement": "EACH",
            "amount": "20"
          },
          "status": "Initiated",
          "statusTime": "2021-10-20T04:39:49.000-05:00",
          "refundAmount": {
            "currency": "MXN",
            "amount": "2000"
          },
          "soPrimeLineSubLineNo": "20211020002-1-1",
          "isWFSEnabled": "N"
        }
      ],
      "returnOrderShipments": [
        {
          "shipmentNo": "R100535949_SHIP_1",
          "status": "DELIVERED"
        }
      ]
    }
  ]
}
```