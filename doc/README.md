LIF - Instal stand alone node server
====================================

# Setup dns
## Setup dns on Godday.com
1. Browse to https://account.godaddy.com/products
2. Login with your Godaddy account
3. In "Domains" section, click on "Manage All -->"
4. Find your domain (eg. mydomain.com) and click on it
5. Click on "DNS" tab
6. Click on Hostnames tab
7. Click "Add Hostname" and enter
   Host: lif--dns1
   IP Address: your server public IP (eg. 1.2.3.4)
8. Click save
9. Click "Add" to add a second host:
   Host: lif--dns2
   IP Address: your server public IP (eg. 1.2.3.4)
10. Click on "Nameservers" tab
11. Click on Change Nameservers"
12. Click on "I'll use my own nameservers" and enter
    lif--dns1.<your domain> (eg. lif--dns1.mydomain.com)
    lif--dns2.<your domain> (eg. lif--dns2.mydomain.com>
13. click "Save"
14. In the confirmation dialog, click "Continue"
15. Browse to http://<your server ip>/ and wait until you see "XXX DNS is ready"
    It will take around 30 minuthe for thee change to take effect.

## XXX TODO: Setup dns on other dns providers

